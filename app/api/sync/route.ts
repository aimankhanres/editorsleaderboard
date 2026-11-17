import { NextResponse } from 'next/server';
import { cfg } from '@/lib/config';
import { isCronAuthorized } from '@/lib/auth';
import { monthOf, monthStart, prevMonth, todayIn } from '@/lib/dates';
import { adTotals, diagnose, fetchAdSpend, probe } from '@/lib/triplewhale';
import { clickupCheck, lookupBriefs } from '@/lib/clickup';
import { extractBriefIds } from '@/lib/briefs';
import { allocate, buildTeams } from '@/lib/leaderboard';
import * as store from '@/lib/store';

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
  if (url.searchParams.get('diag') === 'clickup') return NextResponse.json(await clickupCheck('AOG-10150'));
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
      sample: rows.slice(0, 10),
    });
  }

  if (!cfg.hasDb) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
  const runId = await store.startSyncRun();
  let ads = 0, lookups = 0;
  try {
    // 1-2. Spend
    const rows = await fetchAdSpend(from, today);
    await store.upsertAdSpend(rows);
    ads = new Set(rows.map(r => r.adId)).size;

    // 3. ClickUp lookups for new / stale briefs
    const todo = await store.briefsNeedingLookup(from, cfg.maxLookups);
    const res = await lookupBriefs(todo, deadline - 20_000);
    lookups = res.lookups;
    await store.upsertBriefs(res.resolved);
    await store.markBriefsErrored(res.failed);
    await store.upsertEditors(res.resolved.flatMap(b => b.editors));

    // 4. Snapshot today's ranks per synced month
    const roster = await store.loadRoster();
    for (const m of months) {
      const monthAds = await store.loadMonthAds(m);
      const briefs = await store.loadBriefMap([...new Set(monthAds.flatMap(a => a.briefIds))]);
      const { editors } = allocate(monthAds, briefs, roster);
      await store.writeSnapshot(today, m, editors.map((e, i) => ({ key: e.key, spend: e.spend, rank: i + 1 })));
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
