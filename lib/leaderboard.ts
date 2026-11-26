import { cfg } from './config';
import { addDays, nextMonth, todayIn } from './dates';
const CAPACITY_TZ = process.env.CAPACITY_TIMEZONE ?? 'Asia/Karachi'; // same as lib/capacity
import type {
  AdAgg, BriefInfo, EditorBrief, EditorRef, EditorRow, LeaderboardPayload, ReviewItem, RosterEntry, TeamBoard, WinnerAd,
} from './types';
import { TEAMS, TEAMS_OF, boardOf, countsOnTeam, memberKey, tierOf, type Team } from './teams';
import { snapPrefix, viewChannels, type ChannelView } from './channels';
import { isBareNumber, isInternalKey, isOtherWorkspaceBrief } from './briefs';

type Acc = { key: string; name: string; avatar: string | null; active: boolean; spend: number; ads: Set<string>;
  briefs: Map<string, { info: BriefInfo; spend: number; ads: Set<string> }>; winners: Map<string, WinnerAd> };

export type Allocation = {
  total: number;
  attributed: number;
  editors: Omit<EditorRow, 'rank' | 'prevRank'>[];
  review: ReviewItem[];
  /** Dollars credited to at least one roster editor in each scope, each dollar counted ONCE (for "All …" totals) */
  scopeSpend: ScopeSpend;
};
export type ScopeSpend = { all: number; internal: number; agency: number };

const TEAM_GROUP = new Map(TEAMS.map(t => [t.id, t.group]));
/** The scope a credit lands in: the team board it shows on for that person (lib/teams countsOnTeam), or null when the
 * person isn't on any team list */
function scopeOfCredit(key: string, board: string | null): 'internal' | 'agency' | null {
  const teams = TEAMS_OF.get(key);
  if (!teams?.length) return null;
  const team = board && teams.includes(board) ? board : teams[0];
  return TEAM_GROUP.get(team) === 'Agency' ? 'agency' : 'internal';
}

const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z]+/).filter(t => t.length >= 3));
const firstName = (name: string) => name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';

/**
 * Pure attribution. Ad spend -> briefs (split evenly) -> editors (split or joint).
 * Everything that can't be credited ends up in `review` with its spend; nothing is dropped.
 */
export { isOtherWorkspaceBrief } from './briefs';

export function allocate(
  ads: AdAgg[],
  briefs: Map<string, BriefInfo>,
  roster: Map<string, RosterEntry>,
  splitMode: 'split' | 'joint' = cfg.splitMode,
  winnerSpend: number = cfg.winnerSpend,
): Allocation {
  const acc = new Map<string, Acc>();
  const review: ReviewItem[] = [];
  let total = 0;
  let attributed = 0;
  const scopeSpend: ScopeSpend = { all: 0, internal: 0, agency: 0 };

  // Ad-name cross-check: only the editors on the team lists (lib/teams.ts). First name, plus a nickname
  // written in brackets, e.g. "Lucylen (Lucy) Pagado" matches "Lucylen" and "Lucy".
  const rosterFirst = new Map<string, string[]>(); // name token -> editor keys
  const watchNames = new Map<string, string>();
  for (const m of TEAMS.filter(t => t.nameCheck).flatMap(t => t.members)) {
    if (!m.id) continue;
    const key = `u:${m.id}`;
    watchNames.set(key, m.name);
    const names = [firstName(m.name.replace(/\(.*?\)/g, ' ')), ...[...m.name.matchAll(/\(([^)]+)\)/g)].map(x => firstName(x[1]))];
    for (const f of new Set(names)) {
      if (f.length >= 3 && !(rosterFirst.get(f) ?? []).includes(key)) rosterFirst.set(f, [...(rosterFirst.get(f) ?? []), key]);
    }
  }

  const credit = (ed: EditorRef[], amount: number, ad: AdAgg, info: BriefInfo) => {
    const groups: EditorRef[][] = splitMode === 'joint' ? [ed] : ed.map(e => [e]);
    const each = amount / groups.length;
    for (const g of groups) {
      const sorted = [...g].sort((a, b) => a.key.localeCompare(b.key));
      const key = sorted.map(e => e.key).join('+');
      const names = sorted.map(e => roster.get(e.key)?.name ?? e.name);
      const active = sorted.every(e => roster.get(e.key)?.active ?? true);
      let a = acc.get(key);
      if (!a) {
        a = { key, name: names.join(' / '), active, spend: 0, ads: new Set(), briefs: new Map(), winners: new Map(),
          avatar: sorted.length === 1 ? (roster.get(sorted[0].key)?.avatar ?? sorted[0].avatar ?? null) : null };
        acc.set(key, a);
      }
      a.spend += each;
      a.ads.add(ad.adId);
      // Winner = a single ad whose own spend reached the threshold; counts for every editor credited on it
      if (ad.spend >= winnerSpend && !a.winners.has(ad.adId)) {
        a.winners.set(ad.adId, { adId: ad.adId, adName: ad.adName, spend: round2(ad.spend), briefId: info.briefId, taskUrl: info.taskUrl });
      }
      const b = a.briefs.get(info.briefId) ?? { info, spend: 0, ads: new Set<string>() };
      b.spend += each;
      b.ads.add(ad.adId);
      a.briefs.set(info.briefId, b);
    }
  };

  for (const ad of ads) {
    total += ad.spend;
    if (!ad.briefIds.length) {
      review.push({ kind: 'no_brief_id', adId: ad.adId, adName: ad.adName, spend: ad.spend });
      continue;
    }
    const share = ad.spend / ad.briefIds.length;
    const creditedKeys = new Set<string>();
    // which scopes this share of the ad shows up in (each scope counts it once, however many people get it)
    const landed = (eds: EditorRef[], b: BriefInfo, scopes: Set<string>) => {
      const board = boardOf({ listId: b.listId ?? null, workspace: b.workspace, product: b.product, name: b.taskName });
      for (const e of eds) { const sc = scopeOfCredit(e.key, board); if (sc) scopes.add(sc); }
    };
    const creditedTokens = new Set<string>(); // every name word of the credited editors

    for (const briefId of ad.briefIds) {
      const info = briefs.get(briefId);
      const base = { adId: ad.adId, adName: ad.adName, spend: share, briefId, taskUrl: info?.taskUrl ?? null };
      const scopes = new Set<string>();
      const countScopes = () => {
        if (scopes.size) scopeSpend.all += share;
        if (scopes.has('internal')) scopeSpend.internal += share;
        if (scopes.has('agency')) scopeSpend.agency += share;
      };
      const resizeOk = !!info && info.status === 'ok' && info.editors.length > 0;
      // Agency (6-digit) briefs: the original agency editor is credited too, on the agency board. The resize editor
      // keeps their credit on the Resizing board; `attributed` counts the dollar once.
      const agencyEds = (info?.agency?.editors ?? []).filter(e => !(resizeOk && info!.editors.some(x => x.key === e.key)));
      if (info?.agency && agencyEds.length) {
        const agencyInfo: BriefInfo = {
          ...info, taskId: null, taskName: info.agency.taskName, taskUrl: info.agency.taskUrl, editors: agencyEds,
          status: 'ok', listId: null, workspace: 'agency', product: info.agency.product,
        };
        credit(agencyEds, share, ad, agencyInfo);
        landed(agencyEds, agencyInfo, scopes);
        if (resizeOk) landed(info.editors, info, scopes);
        countScopes();
        if (!resizeOk) attributed += share;
        agencyEds.forEach(e => { creditedKeys.add(e.key); for (const t of tokens(e.name)) creditedTokens.add(t); });
        if (!resizeOk) continue;
      }
      if (!info || info.status === 'pending' || info.status === 'error') {
        review.push({ ...base, kind: 'pending', detail: info?.status === 'error' ? 'ClickUp lookup failed, will retry' : 'Not looked up yet' });
      } else if (info.status === 'not_found' && info.taskName) {
        review.push({ ...base, kind: 'task_not_found', detail: info.taskName }); // bare number matching several briefs
      } else if (info.status === 'not_found' && isOtherWorkspaceBrief(briefId)) {
        review.push({ ...base, kind: 'other_workspace', detail: 'Original brief is in another workspace; no resize task found' });
      } else if (info.status === 'not_found' && isInternalKey(briefId)) {
        review.push({ ...base, kind: 'task_not_found', detail: `No ClickUp task with an Editor is named ${briefId.replace(/^[A-Z]*/, '').replace('-W', '_W')}…` });
      } else if (info.status === 'not_found' && isBareNumber(briefId)) {
        review.push({ ...base, kind: 'task_not_found', detail: `No OO-/AOG-/CIN-${briefId.slice(1)} task in ClickUp` });
      } else if (info.status === 'not_found') {
        review.push({ ...base, kind: 'task_not_found', detail: 'No ClickUp task has this Brief ID' });
      } else if (!info.editors.length || info.status === 'no_editor') {
        review.push({ ...base, kind: 'no_editor', detail: info.taskName ?? undefined });
      } else {
        credit(info.editors, share, ad, info);
        attributed += share;
        if (!info.agency || !agencyEds.length) { landed(info.editors, info, scopes); countScopes(); }
        info.editors.forEach(e => {
          creditedKeys.add(e.key);
          for (const n of [e.name, roster.get(e.key)?.name ?? '', watchNames.get(e.key) ?? '']) for (const t of tokens(n)) creditedTokens.add(t);
        });
      }
    }

    // Cross-check: the ad name mentions a known editor who isn't credited by ClickUp
    if (creditedKeys.size && rosterFirst.size) {
      const mentioned = new Set<string>();
      // A word that is also part of the credited editor's own name (shared first names, "Abdul Rehman") is not a conflict
      for (const t of tokens(ad.adName)) if (!creditedTokens.has(t)) for (const k of rosterFirst.get(t) ?? []) mentioned.add(k);
      if (mentioned.size && ![...mentioned].some(k => creditedKeys.has(k))) {
        const named = [...new Set([...mentioned].map(k => watchNames.get(k) ?? roster.get(k)?.name ?? k))].join(', ');
        const credited = [...new Set([...creditedKeys].map(k => watchNames.get(k) ?? roster.get(k)?.name ?? k))].join(', ');
        review.push({
          kind: 'name_mismatch', adId: ad.adId, adName: ad.adName, spend: ad.spend,
          briefId: ad.briefIds.join(', '), taskUrl: briefs.get(ad.briefIds[0])?.taskUrl ?? null,
          detail: `Ad name mentions ${named}; ClickUp credits ${credited}`,
        });
      }
    }
  }

  const editors = [...acc.values()].map(a => ({
    key: a.key,
    name: a.name,
    avatar: a.avatar,
    active: a.active,
    spend: round2(a.spend),
    share: attributed ? a.spend / attributed : 0,
    ads: a.ads.size,
    briefs: [...a.briefs.values()]
      .map((b): EditorBrief => ({ briefId: b.info.briefId, taskName: b.info.taskName, taskUrl: b.info.taskUrl, spend: round2(b.spend), ads: b.ads.size,
        board: boardOf({ listId: b.info.listId ?? null, workspace: b.info.workspace, product: b.info.product, name: b.info.taskName }) }))
      .sort((x, y) => y.spend - x.spend),
    winners: [...a.winners.values()].sort((x, y) => y.spend - x.spend),
  })).sort((x, y) => y.spend - x.spend || x.name.localeCompare(y.name));

  review.sort((a, b) => b.spend - a.spend);
  return { total: round2(total), attributed: round2(attributed), editors, review: review.map(r => ({ ...r, spend: round2(r.spend) })),
    // All = every credited dollar (people not on a team list too); Internal / Agency = only people on those teams
    scopeSpend: { all: round2(attributed), internal: round2(scopeSpend.internal), agency: round2(scopeSpend.agency) } };
}

export function rank(editors: Allocation['editors'], prev: Map<string, number>): EditorRow[] {
  return editors.map((e, i) => ({ ...e, rank: i + 1, prevRank: prev.get(e.key) ?? null }));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One board per team (lib/teams.ts). Only listed members appear; members without spend get a $0 row.
 * Ranks and rank changes are within the team: yesterday's rank comes from re-ranking yesterday's
 * snapshot spends among the same members.
 */
export type AssetCount = { key: string; board: string | null; videos: number; statics: number; minutes: number };

export function buildTeams(editors: Allocation['editors'], prevSpend: Map<string, number>, teams: Team[] = TEAMS,
  assets: AssetCount[] = []): TeamBoard[] {
  const byKey = new Map(editors.map(e => [e.key, e]));
  const teamName = new Map(TEAMS.map(t => [t.id, t.name]));
  // A person on several teams: each team board shows only the spend from briefs on that team's ClickUp board
  // (unplaced briefs count on their home team), and the row lists the split across their teams.
  const part = (key: string, teamId: string) => {
    const e = byKey.get(key);
    if (!e) return { spend: 0, ads: 0, briefs: [], winners: [] };
    if ((TEAMS_OF.get(key) ?? []).length <= 1) return { spend: e.spend, ads: e.ads, briefs: e.briefs, winners: e.winners };
    const briefs = e.briefs.filter(b => countsOnTeam(key, teamId, b.board ?? null));
    const ids = new Set(briefs.map(b => b.briefId));
    return {
      spend: round2(briefs.reduce((a, b) => a + b.spend, 0)), ads: briefs.reduce((a, b) => a + b.ads, 0), briefs,
      winners: e.winners.filter(w => w.briefId.split(', ').some(id => ids.has(id))),
    };
  };
  const assetsOf = (key: string, teamId: string) => assets.filter(a => a.key === key && countsOnTeam(key, teamId, a.board))
    .reduce((acc, a) => ({ videos: acc.videos + a.videos, statics: acc.statics + a.statics, minutes: acc.minutes + a.minutes }), { videos: 0, statics: 0, minutes: 0 });
  return teams.map(team => {
    const rows = team.members.map(m => {
      const key = memberKey(m);
      const e = byKey.get(key);
      const p = part(key, team.id);
      const multi = TEAMS_OF.get(key) ?? [];
      return {
        key, name: m.name, role: m.role, tier: tierOf(m.role), avatar: e?.avatar ?? null, active: true, inClickUp: m.id != null,
        spend: p.spend, ads: p.ads, briefs: p.briefs, winners: p.winners, share: 0, ...assetsOf(key, team.id),
        boards: multi.length > 1 ? multi.map(t => ({ team: t, name: teamName.get(t) ?? t, ...(({ spend, ads }) => ({ spend, ads }))(part(key, t)) })) : undefined,
      };
    });
    rows.sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const prevOrder = team.members
      .map(m => ({ key: memberKey(m), spend: prevSpend.get(memberKey(m)) ?? 0 }))
      .filter(r => r.spend > 0)
      .sort((a, b) => b.spend - a.spend);
    const prevRank = new Map(prevOrder.map((r, i) => [r.key, i + 1]));
    return {
      id: team.id, name: team.name, group: team.group, spend: round2(spend),
      winners: new Set(rows.flatMap(r => r.winners.map(w => w.adId))).size,
      editors: rows.map((r, i) => ({
        ...r, share: spend ? r.spend / spend : 0, rank: i + 1,
        prevRank: r.spend > 0 ? prevRank.get(r.key) ?? null : null,
      })),
    };
  });
}

/** Full payload for one month, read straight from Postgres (or demo data without a DB). */
/**
 * `range` (inclusive dates) replaces the month: spend is summed over exactly those days, and rank
 * changes are not shown (there is no "yesterday" for an arbitrary range).
 */
export async function buildLeaderboard(month: string, view: ChannelView = 'meta', range: { from: string; to: string } | null = null,
  opts: { agency?: boolean } = {}): Promise<LeaderboardPayload> {
  if (!cfg.hasDb) {
    const { demoLeaderboard } = await import('./demo');
    return { ...demoLeaderboard(month, view), range, dataFrom: null, dataTo: null };
  }
  const store = await import('./store');
  const today = todayIn(cfg.timezone);
  const [ads, roster, months, last, prev, prevSpend, span] = await Promise.all([
    range ? store.loadAds(range.from, addDays(range.to, 1), viewChannels(view)) : store.loadMonthAds(month, viewChannels(view)),
    store.loadRoster(),
    store.monthsAvailable(),
    store.lastSync(),
    range ? new Map<string, number>() : store.previousRanks(month, today, snapPrefix(view)),
    range ? new Map<string, number>() : store.previousSpends(month, today, snapPrefix(view)),
    store.dataSpan(),
  ]);
  const [briefMap, assetRows] = await Promise.all([
    store.loadBriefMap([...new Set(ads.flatMap(a => a.briefIds))], { agency: opts.agency ?? cfg.agencyCredit }),
    range ? store.assetsDone(range.from, addDays(range.to, 1), CAPACITY_TZ) : store.assetsDone(`${month}-01`, `${nextMonth(month)}-01`, CAPACITY_TZ),
  ]);
  const assets: AssetCount[] = assetRows.map(r => ({ key: `u:${r.uid}`, board: boardOf({ listId: r.list_id, workspace: r.workspace, product: r.product, name: r.name }), videos: r.videos, statics: r.statics, minutes: Number(r.minutes) || 0 }));
  const alloc = allocate(ads, briefMap, roster);
  return {
    month,
    channel: view,
    range,
    dataFrom: span.from,
    dataTo: span.to,
    months: months.includes(month) ? months : [month, ...months].sort().reverse(),
    total: alloc.total,
    attributed: alloc.attributed,
    editors: rank(alloc.editors, prev),
    teams: buildTeams(alloc.editors, prevSpend, TEAMS, assets),
    scopeSpend: alloc.scopeSpend,
    review: alloc.review,
    lastSync: last,
    splitMode: cfg.splitMode,
    winnerSpend: cfg.winnerSpend,
    demo: false,
  };
}
