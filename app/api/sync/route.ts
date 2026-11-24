import { NextResponse } from 'next/server';
import { cfg } from '@/lib/config';
import { isCronAuthorized } from '@/lib/auth';
import { addDays, monthOf, monthStart, prevMonth, todayIn } from '@/lib/dates';
import { adTotals, diagnose, fetchAdSpend, probe } from '@/lib/triplewhale';
import { briefsEditedBy, clickupCheck, lookupBriefs } from '@/lib/clickup';
import { buildLeaderboard } from '@/lib/leaderboard';
import { TEAMS } from '@/lib/teams';
import { extractBriefIds, isInternalKey } from '@/lib/briefs';
import { allocate, buildTeams } from '@/lib/leaderboard';
import * as store from '@/lib/store';
import { VIEWS, snapPrefix, viewChannels } from '@/lib/channels';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 300; // seconds; Hobby with Fluid compute allows 300
const BUDGET_MS = Number(process.env.SYNC_BUDGET_SECONDS ?? 240) * 1000;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const started = Date.now();
  const deadline = started + BUDGET_MS;
  const url = new URL(req.url);

  const today = todayIn(cfg.timezone);
  const month = monthOf(today);
  const months = Number(today.slice(8, 10)) <= 3 ? [prevMonth(month), month] : [month];
  const from = monthStart(months[0]);

  // ?diag=1 : run variants of the Triple Whale query to see which parts the API accepts. Writes nothing.
  if (url.searchParams.get('diag') === 'clickup') return NextResponse.json(await clickupCheck(url.searchParams.get('brief') || 'AOG-10150'));
  // ?requeue=other : mark 6-digit "not found" briefs for a fresh lookup (resize fallback). Next syncs pick them up.
  if (url.searchParams.get('requeue') === 'internal') {
    if (!cfg.hasDb) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
    return NextResponse.json({ requeued: await store.requeueInternalBriefs() });
  }
  if (url.searchParams.get('requeue') === 'other') {
    if (!cfg.hasDb) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
    return NextResponse.json({ requeued: await store.requeueOtherWorkspaceBriefs() });
  }
  // ?reextract=1 : re-run brief extraction on stored ad names (after the rules in lib/briefs.ts change)
  if (url.searchParams.get('reextract')) {
    if (!cfg.hasDb) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
    return NextResponse.json({ adNamesChanged: await store.reextractBriefIds() });
  }
  // ?diag=channel&channel=google-ads : read-only check of how much of another channel's spend is traceable
  // to briefs/editors, using the brief lookups we already have. Writes nothing.
  if (url.searchParams.get('diag') === 'channel') {
    const channel = url.searchParams.get('channel') || 'google-ads';
    const ads = (await adTotals(channel, from, today)).map(a => ({ ...a, campaign: a.campaign ?? '', briefIds: extractBriefIds(a.adName) }));
    const sum = (xs: { spend: number }[]) => Math.round(xs.reduce((s, x) => s + x.spend, 0));
    const withBrief = ads.filter(a => a.briefIds.length);
    const byType = new Map<string, { ads: number; spend: number; withBrief: number }>();
    for (const a of ads) {
      const k = a.campaignType || '(none)';
      const t = byType.get(k) ?? { ads: 0, spend: 0, withBrief: 0 };
      t.ads++; t.spend += a.spend; if (a.briefIds.length) t.withBrief += a.spend;
      byType.set(k, t);
    }
    const briefIds = [...new Set(withBrief.flatMap(a => a.briefIds))];
    const briefMap = cfg.hasDb ? await store.loadBriefMap(briefIds) : new Map();
    const roster = cfg.hasDb ? await store.loadRoster() : new Map();
    const alloc = allocate(ads, briefMap, roster);
    const kinds = new Map<string, number>();
    for (const r of alloc.review) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + r.spend);
    const teams = buildTeams(alloc.editors, new Map()).map(t => ({
      team: t.name, spend: Math.round(t.spend), withSpend: t.editors.filter(e => e.spend > 0).length,
      top: t.editors.filter(e => e.spend > 0).slice(0, 5).map(e => `${e.name} $${Math.round(e.spend)}`),
    }));
    return NextResponse.json({
      channel, from, to: today, ads: ads.length, total: sum(ads), withBriefId: sum(withBrief),
      briefs: briefIds.length, briefsAlreadyLookedUp: briefMap.size,
      creditedToEditors: Math.round(alloc.attributed),
      notCredited: Object.fromEntries([...kinds].map(([k, v]) => [k, Math.round(v)])),
      byCampaignType: Object.fromEntries([...byType].map(([k, v]) => [k, { ads: v.ads, spend: Math.round(v.spend), withBriefId: Math.round(v.withBrief) }])),
      teams,
      topNoBrief: ads.filter(a => !a.briefIds.length).sort((a, b) => b.spend - a.spend).slice(0, 8)
        .map(a => `${Math.round(a.spend)} | ${a.campaignType ?? ''} | ${a.adName.slice(0, 70)} | ${(a.campaign ?? '').slice(0, 40)}`),
      sampleWithBrief: [...withBrief].sort((a, b) => b.spend - a.spend).slice(0, 6).map(a => `${Math.round(a.spend)} | ${a.adName.slice(0, 80)}`),
    });
  }
  // ?diag=audit&team=resizing&offset=0&limit=10 : read-only. For each listed editor, fetch every ClickUp task
  // where they are in the Editor field and check that each brief the dashboard credits to them is one of those.
  if (url.searchParams.get('diag') === 'audit') {
    const team = TEAMS.find(t => t.id === url.searchParams.get('team')) ?? TEAMS[0];
    const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 8);
    const lb = await buildLeaderboard(month, 'all');
    const board = lb.teams.find(t => t.id === team.id)!;
    const out = [];
    for (const m of team.members.slice(offset, offset + limit)) {
      if (!m.id) { out.push({ editor: m.name, skipped: 'not in ClickUp' }); continue; }
      const row = board.editors.find(e => e.key === `u:${m.id}`);
      const credited = row?.briefs ?? [];
      if (Date.now() > deadline) { out.push({ editor: m.name, skipped: 'time budget' }); continue; }
      const mine = await briefsEditedBy(m.id);
      const notTheirs = credited.filter(b => !mine.briefs.has(b.briefId));
      out.push({
        editor: m.name, spend: Math.round(row?.spend ?? 0), creditedBriefs: credited.length, clickupTasks: mine.tasks,
        verified: credited.length - notTheirs.length,
        notTheirs: notTheirs.map(b => ({ briefId: b.briefId, spend: Math.round(b.spend), task: b.taskName, url: b.taskUrl })),
      });
    }
    return NextResponse.json({ team: team.name, month, offset, limit, total: team.members.length, editors: out });
  }
  if (url.searchParams.get('diag')) return NextResponse.json(await diagnose(from, today));

  // ?dry=1 : fetch spend only, write nothing. Use it to check Triple Whale numbers against Ads Manager.
  if (url.searchParams.get('dry')) {
    let rows;
    try {
      rows = await fetchAdSpend(from, today);
    } catch (e) {
      console.error('dry run failed', e);
      // Also run Triple Whale's documented example query: if that works, our query is the problem.
      const exampleQuery = await probe(from, today);
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), exampleQuery }, { status: 500 });
    }
    const total = rows.reduce((s, r) => s + r.spend, 0);
    const withBrief = rows.filter(r => r.briefIds.length).reduce((s, r) => s + r.spend, 0);
    return NextResponse.json({
      from, to: today, rows: rows.length, ads: new Set(rows.map(r => r.adId)).size,
      total: Math.round(total * 100) / 100, withBriefId: Math.round(withBrief * 100) / 100,
      byChannel: Object.fromEntries([...new Set(rows.map(r => r.channel ?? ''))].map(c => {
        const rs = rows.filter(r => r.channel === c);
        return [c, { ads: new Set(rs.map(r => r.adId)).size, total: Math.round(rs.reduce((s, r) => s + r.spend, 0)),
          withBriefId: Math.round(rs.filter(r => r.briefIds.length).reduce((s, r) => s + r.spend, 0)) }];
      })),
      sample: rows.slice(0, 10),
    });
  }

  if (!cfg.hasDb) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
  const runId = await store.startSyncRun();
  let ads = 0, lookups = 0;
  try {
    // 1-2. Spend. Refetching the whole month every run gets slower each day and hits the 300s limit late in the
    // month, so each run fetches the last 3 days (Triple Whale still revises those) plus 3 older days in rotation
    // (every older day is refreshed several times a day). ?full=1 refetches everything.
    const rows: Awaited<ReturnType<typeof fetchAdSpend>> = [];
    for (const [a, b] of syncWindows(from, today, url.searchParams.get('full') === '1')) rows.push(...await fetchAdSpend(a, b));
    await store.upsertAdSpend(rows);
    ads = new Set(rows.map(r => r.adId)).size;

    // 3. ClickUp lookups for new / stale briefs
    const todoAll = await store.briefsNeedingLookup(from, cfg.maxLookups);
    // Internal "#103_W2" briefs are matched by task name from the task mirror (cu_tasks), not the ClickUp API
    const internal = todoAll.filter(isInternalKey);
    if (internal.length) await store.upsertBriefs(await store.resolveInternalBriefs(internal));
    const todo = todoAll.filter(k => !isInternalKey(k));
    const res = await lookupBriefs(todo, deadline - 20_000);
    lookups = res.lookups;
    await store.upsertBriefs(res.resolved);
    await store.markBriefsErrored(res.failed);
    await store.upsertEditors(res.resolved.flatMap(b => b.editors));

    // 4. Snapshot today's ranks per synced month
    const roster = await store.loadRoster();
    for (const m of months) {
      for (const v of VIEWS) {
        const monthAds = await store.loadMonthAds(m, viewChannels(v.id));
        const briefs = await store.loadBriefMap([...new Set(monthAds.flatMap(a => a.briefIds))]);
        const { editors } = allocate(monthAds, briefs, roster);
        await store.writeSnapshot(today, m, editors.map((e, i) => ({ key: e.key, spend: e.spend, rank: i + 1 })), snapPrefix(v.id));
      }
    }

    // 5. Log
    const pending = await store.countPendingBriefs(from);
    await store.finishSyncRun(runId, { ok: true, ads, lookups, pending, error: res.rateLimited ? 'ClickUp rate limited; will continue next run' : null });
    return NextResponse.json({
      ok: true, months, rows: rows.length, ads, lookups, resolved: res.resolved.length, failed: res.failed.length,
      lookupError: res.firstError, pending, rateLimited: res.rateLimited, ms: Date.now() - started,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('sync failed', e);
    await store.finishSyncRun(runId, { ok: false, ads, lookups, pending: 0, error: msg }).catch(() => {});
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** Day ranges [from, to] (inclusive) to fetch this run: the last 3 days plus a rotating slice of older days. */
function syncWindows(from: string, today: string, full: boolean): [string, string][] {
  const recentFrom = addDays(today, -2) < from ? from : addDays(today, -2);
  if (full || recentFrom === from) return [[from, today]];
  const older: string[] = [];
  for (let d = from; d < recentFrom; d = addDays(d, 1)) older.push(d);
  const SLICE = 3;
  const slices = Math.ceil(older.length / SLICE);
  const pick = Math.floor(Date.now() / (15 * 60_000)) % slices; // changes every 15 minutes
  const part = older.slice(pick * SLICE, pick * SLICE + SLICE);
  return [[part[0], part[part.length - 1]], [recentFrom, today]];
}
