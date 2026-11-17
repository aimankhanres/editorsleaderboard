import { cfg } from './config';
import { addDays, todayIn } from './dates';
import type {
  AdAgg, BriefInfo, EditorBrief, EditorRef, EditorRow, LeaderboardPayload, ReviewItem, RosterEntry, TeamBoard, WinnerAd,
} from './types';
import { TEAMS, type Team } from './teams';
import { snapPrefix, viewChannels, type ChannelView } from './channels';

type Acc = { key: string; name: string; avatar: string | null; active: boolean; spend: number; ads: Set<string>;
  briefs: Map<string, { info: BriefInfo; spend: number; ads: Set<string> }> };

export type Allocation = {
  total: number;
  attributed: number;
  editors: Omit<EditorRow, 'rank' | 'prevRank'>[];
  review: ReviewItem[];
};

const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z]+/).filter(t => t.length >= 3));
const firstName = (name: string) => name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';

/**
 * Pure attribution. Ad spend -> briefs (split evenly) -> editors (split or joint).
 * Everything that can't be credited ends up in `review` with its spend; nothing is dropped.
 */
/**
 * 6-digit brief IDs (OO-102573, AOG-100721, CIN-102186 ...) are created in a separate ClickUp workspace
 * (resize tasks link to them via "Org Task ID"), which our token cannot read. When one isn't found in
 * Resilia's workspace, list it on its own instead of as a broken "not found".
 */
export function isOtherWorkspaceBrief(briefId: string): boolean {
  return /^[A-Z]+-\d{6,}$/.test(briefId);
}

export function allocate(
  ads: AdAgg[],
  briefs: Map<string, BriefInfo>,
  roster: Map<string, RosterEntry>,
  splitMode: 'split' | 'joint' = cfg.splitMode,
  winnerSpend: number = cfg.winnerSpend,
): Allocation {
  const acc = new Map<string, Acc>();
  // Full spend and ads per credited brief (before splitting between editors), for winner detection
  const briefTotals = new Map<string, { spend: number; ads: Set<string> }>();
  const review: ReviewItem[] = [];
  let total = 0;
  let attributed = 0;

  // First names of known editors, for the ad-name cross-check
  const rosterFirst = new Map<string, string[]>(); // first name -> editor keys
  for (const [key, r] of roster) {
    const f = firstName(r.name);
    if (f.length >= 3) rosterFirst.set(f, [...(rosterFirst.get(f) ?? []), key]);
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
        a = { key, name: names.join(' / '), active, spend: 0, ads: new Set(), briefs: new Map(),
          avatar: sorted.length === 1 ? (roster.get(sorted[0].key)?.avatar ?? sorted[0].avatar ?? null) : null };
        acc.set(key, a);
      }
      a.spend += each;
      a.ads.add(ad.adId);
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

    for (const briefId of ad.briefIds) {
      const info = briefs.get(briefId);
      const base = { adId: ad.adId, adName: ad.adName, spend: share, briefId, taskUrl: info?.taskUrl ?? null };
      if (!info || info.status === 'pending' || info.status === 'error') {
        review.push({ ...base, kind: 'pending', detail: info?.status === 'error' ? 'ClickUp lookup failed, will retry' : 'Not looked up yet' });
      } else if (info.status === 'not_found' && isOtherWorkspaceBrief(briefId)) {
        review.push({ ...base, kind: 'other_workspace', detail: 'Original brief lives in another ClickUp workspace' });
      } else if (info.status === 'not_found') {
        review.push({ ...base, kind: 'task_not_found', detail: 'No ClickUp task has this Brief ID' });
      } else if (!info.editors.length || info.status === 'no_editor') {
        review.push({ ...base, kind: 'no_editor', detail: info.taskName ?? undefined });
      } else {
        credit(info.editors, share, ad, info);
        const bt = briefTotals.get(briefId) ?? { spend: 0, ads: new Set<string>() };
        bt.spend += share;
        bt.ads.add(ad.adId);
        briefTotals.set(briefId, bt);
        attributed += share;
        info.editors.forEach(e => creditedKeys.add(e.key));
      }
    }

    // Cross-check: the ad name mentions a known editor who isn't credited by ClickUp
    if (creditedKeys.size && rosterFirst.size) {
      const mentioned = new Set<string>();
      for (const t of tokens(ad.adName)) for (const k of rosterFirst.get(t) ?? []) mentioned.add(k);
      if (mentioned.size && ![...mentioned].some(k => creditedKeys.has(k))) {
        const named = [...mentioned].map(k => roster.get(k)?.name ?? k).join(', ');
        const credited = [...creditedKeys].map(k => roster.get(k)?.name ?? k).join(', ');
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
      .map((b): EditorBrief => ({ briefId: b.info.briefId, taskName: b.info.taskName, taskUrl: b.info.taskUrl, spend: round2(b.spend), ads: b.ads.size }))
      .sort((x, y) => y.spend - x.spend),
    // Winner = a brief whose ads together reached the threshold; counts for every editor on it
    winners: [...a.briefs.values()]
      .map(b => ({ b, t: briefTotals.get(b.info.briefId) }))
      .filter(({ t }) => t && t.spend >= winnerSpend)
      .map(({ b, t }): WinnerAd => ({ briefId: b.info.briefId, taskName: b.info.taskName, taskUrl: b.info.taskUrl, spend: round2(t!.spend), ads: t!.ads.size }))
      .sort((x, y) => y.spend - x.spend),
  })).sort((x, y) => y.spend - x.spend || x.name.localeCompare(y.name));

  review.sort((a, b) => b.spend - a.spend);
  return { total: round2(total), attributed: round2(attributed), editors, review: review.map(r => ({ ...r, spend: round2(r.spend) })) };
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
export function buildTeams(editors: Allocation['editors'], prevSpend: Map<string, number>, teams: Team[] = TEAMS): TeamBoard[] {
  const byKey = new Map(editors.map(e => [e.key, e]));
  return teams.map(team => {
    const rows = team.members.map(m => {
      const key = `u:${m.id}`;
      const e = byKey.get(key);
      return {
        key, name: m.name, role: m.role, avatar: e?.avatar ?? null, active: true,
        spend: e?.spend ?? 0, ads: e?.ads ?? 0, briefs: e?.briefs ?? [], winners: e?.winners ?? [], share: 0,
      };
    });
    rows.sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const prevOrder = team.members
      .map(m => ({ key: `u:${m.id}`, spend: prevSpend.get(`u:${m.id}`) ?? 0 }))
      .filter(r => r.spend > 0)
      .sort((a, b) => b.spend - a.spend);
    const prevRank = new Map(prevOrder.map((r, i) => [r.key, i + 1]));
    return {
      id: team.id, name: team.name, spend: round2(spend),
      winners: new Set(rows.flatMap(r => r.winners.map(w => w.briefId))).size,
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
export async function buildLeaderboard(month: string, view: ChannelView = 'meta', range: { from: string; to: string } | null = null): Promise<LeaderboardPayload> {
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
  const briefMap = await store.loadBriefMap([...new Set(ads.flatMap(a => a.briefIds))]);
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
    teams: buildTeams(alloc.editors, prevSpend),
    review: alloc.review,
    lastSync: last,
    splitMode: cfg.splitMode,
    winnerSpend: cfg.winnerSpend,
    demo: false,
  };
}
