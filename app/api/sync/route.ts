import { NextResponse } from 'next/server';
import { cfg } from '@/lib/config';
import { isCronAuthorized } from '@/lib/auth';
import { monthOf, monthStart, prevMonth, todayIn } from '@/lib/dates';
import { fetchAdSpend } from '@/lib/triplewhale';
import { lookupBriefs } from '@/lib/clickup';
import { allocate } from '@/lib/leaderboard';
import * as store from '@/lib/store';

export const dynamic = 'force-dynamic';
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

  // ?dry=1 : fetch spend only, write nothing. Use it to check Triple Whale numbers against Ads Manager.
  if (url.searchParams.get('dry')) {
    const rows = await fetchAdSpend(from, today);
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
    return NextResponse.json({ ok: true, months, rows: rows.length, ads, lookups, pending, rateLimited: res.rateLimited, ms: Date.now() - started });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('sync failed', e);
    await store.finishSyncRun(runId, { ok: false, ads, lookups, pending: 0, error: msg }).catch(() => {});
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
