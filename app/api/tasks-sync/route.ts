import { NextResponse } from 'next/server';
import { cfg } from '@/lib/config';
import { isCronAuthorized } from '@/lib/auth';
import { agencyAccessCheck, agencyToken, editorTasksPage, RateLimited, streamTasksPage, type MirrorStream } from '@/lib/clickup';
import * as store from '@/lib/store';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 300;
const BUDGET_MS = 240_000;

/** Paging state kept in kv: pages of "updated after `since`" tasks, oldest first. */
type State = { since: number; page: number; maxSeen: number };
const KV: Record<MirrorStream, string> = { editor: 'tasks_sync', pipeline: 'tasks_sync_pipeline', agency: 'tasks_sync_agency' };

/**
 * Keeps cu_tasks (every ClickUp task with an Editor) in sync, incrementally: each run pages through tasks updated
 * since the last pass, oldest update first, and saves its place after every page, so a long first backfill simply
 * continues on the next run. Read-only towards ClickUp. Called by the GitHub workflow after /api/sync.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!cfg.hasDb) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
  const started = Date.now();
  const url = new URL(req.url);

  // ?diag=agency : what CLICKUP_AGENCY_TOKEN can see in the agency workspace (read-only)
  if (url.searchParams.get('diag') === 'agency') return NextResponse.json(await agencyAccessCheck());
  // ?diag=editors : every user found in an Editor field, with task counts (read-only; for mapping the roster)
  if (url.searchParams.get('diag') === 'editors') {
    await store.ensureTaskTables();
    return NextResponse.json(await q(
      `SELECT (e->>'id')::bigint AS id, max(e->>'name') AS name, COUNT(*)::int AS tasks,
              COUNT(*) FILTER (WHERE COALESCE(edit_done, delivered) > now() - interval '30 days')::int AS done30,
              mode() WITHIN GROUP (ORDER BY list_name) AS top_list
         FROM cu_tasks, jsonb_array_elements(editors) e WHERE ($1::text IS NULL OR workspace = $1) GROUP BY 1 ORDER BY tasks DESC`,
      [url.searchParams.get('ws')]));
  }
  // ?diag=editor&id=<clickup user id> : that editor's tasks touched in the last 14 days, with their dates (read-only)
  if (url.searchParams.get('diag') === 'editor') {
    await store.ensureTaskTables();
    return NextResponse.json(await q(
      `SELECT name, list_name, status, status_type, to_char(edit_done, 'MM-DD HH24:MI') edit_done,
              to_char(delivered, 'MM-DD HH24:MI') delivered, to_char(assigned, 'MM-DD') assigned,
              to_char(updated_at, 'MM-DD HH24:MI') updated, to_char(closed_at, 'MM-DD') closed
         FROM cu_tasks WHERE $1::bigint = ANY(editor_ids) AND updated_at > now() - interval '14 days'
        ORDER BY updated_at DESC LIMIT 60`, [Number(url.searchParams.get('id'))]));
  }
  // ?diag=agencymatch&month=YYYY-MM : 6-digit (agency) briefs with spend that month, how they're credited today, and
  // whether the agency workspace task for the same Brief ID has an Editor (read-only; for deciding agency attribution)
  if (url.searchParams.get('diag') === 'agencymatch') {
    await store.ensureTaskTables();
    const month = url.searchParams.get('month') ?? new Date().toISOString().slice(0, 7);
    const rows = await q<{ brief_id: string; spend: number; status: string | null; cur: string | null; agency: string | null; agency_tasks: number; agency_status: string | null }>(
      `WITH spend AS (
         SELECT b AS brief_id, sum(a.spend / jsonb_array_length(a.brief_ids))::float AS spend
           FROM ad_spend a, jsonb_array_elements_text(a.brief_ids) b
          WHERE a.spend_date >= ($1 || '-01')::date AND a.spend_date < (($1 || '-01')::date + interval '1 month')
            AND b ~ '^[A-Z]+-[0-9]{6,}$'
          GROUP BY 1)
       SELECT s.brief_id, s.spend, m.status,
              (SELECT string_agg(e->>'name', ' / ') FROM jsonb_array_elements(m.editors) e) AS cur,
              (SELECT string_agg(DISTINCT e->>'name', ' / ') FROM cu_tasks t, jsonb_array_elements(t.editors) e
                WHERE t.workspace = 'agency' AND (upper(t.brief_id) = s.brief_id OR upper(t.name) LIKE s.brief_id || '%')) AS agency,
              (SELECT COUNT(*)::int FROM cu_tasks t WHERE t.workspace = 'agency' AND (upper(t.brief_id) = s.brief_id OR upper(t.name) LIKE s.brief_id || '%')) AS agency_tasks,
              (SELECT min(t.status) FROM cu_tasks t WHERE t.workspace = 'agency' AND (upper(t.brief_id) = s.brief_id OR upper(t.name) LIKE s.brief_id || '%')) AS agency_status
         FROM spend s LEFT JOIN brief_map m ON m.brief_id = s.brief_id
        ORDER BY s.spend DESC`, [month]);
    const bucket = (r: typeof rows[number]) =>
      `${r.status === 'ok' && r.cur ? 'credited_now' : r.status === 'no_editor' ? 'editor_empty_now' : 'not_credited_now'}|${r.agency ? 'agency_has_editor' : r.agency_tasks ? 'agency_task_no_editor' : 'no_agency_task'}`;
    const summary: Record<string, { briefs: number; spend: number }> = {};
    for (const r of rows) { const k = bucket(r); summary[k] = { briefs: (summary[k]?.briefs ?? 0) + 1, spend: Math.round((summary[k]?.spend ?? 0) + r.spend) }; }
    const byAgencyEditor: Record<string, number> = {};
    for (const r of rows) if (r.agency) for (const n of r.agency.split(' / ')) byAgencyEditor[n] = Math.round((byAgencyEditor[n] ?? 0) + r.spend / r.agency.split(' / ').length);
    return NextResponse.json({ month, briefs: rows.length, summary, byAgencyEditor: Object.entries(byAgencyEditor).sort((a, b) => b[1] - a[1]),
      sample: rows.slice(0, 25) });
  }
  if (url.searchParams.get('diag')) {
    const p = await editorTasksPage(Number(url.searchParams.get('since') ?? 0), Number(url.searchParams.get('page') ?? 0));
    return NextResponse.json({ n: p.tasks.length, lastPage: p.lastPage, sample: p.tasks.slice(0, 3) });
  }

  await store.ensureTaskTables();
  // ?reset=editor|pipeline|agency : start that stream over from the beginning (e.g. after adding mirrored fields)
  const reset = url.searchParams.get('reset');
  if (reset) await store.kvSet(KV[reset as MirrorStream] ?? 'x', { since: 0, page: 0, maxSeen: 0 });

  // Streams in priority order; each pages until caught up, then the next one gets the rest of the time budget.
  const streams: MirrorStream[] = ['editor', 'pipeline', ...(agencyToken() ? ['agency' as const] : [])];
  const report: Record<string, { pages: number; saved: number; caughtUp: boolean; since: string | null }> = {};
  let rateLimited = false;
  for (const stream of streams) {
    let state = (await store.kvGet<State>(KV[stream])) ?? { since: 0, page: 0, maxSeen: 0 };
    const r = { pages: 0, saved: 0, caughtUp: false, since: null as string | null };
    report[stream] = r;
    try {
      while (Date.now() - started < BUDGET_MS) {
        const { tasks, lastPage } = await streamTasksPage(stream, state.since, state.page);
        const keep = stream === 'editor' ? tasks.filter(t => t.editors.length) : tasks;
        await store.upsertCuTasks(keep);
        r.saved += keep.length; r.pages++;
        const maxSeen = Math.max(state.maxSeen, ...tasks.map(t => t.updated ?? 0));
        // End of this pass: next pass asks for anything updated after the newest update we saw (minus 1s slack)
        state = lastPage ? { since: Math.max(state.since, maxSeen - 1000), page: 0, maxSeen } : { ...state, page: state.page + 1, maxSeen };
        await store.kvSet(KV[stream], state);
        if (lastPage) { r.caughtUp = true; break; }
      }
    } catch (e) {
      if (e instanceof RateLimited) { rateLimited = true; continue; }
      return NextResponse.json({ ok: false, stream, error: e instanceof Error ? e.message : String(e), report }, { status: 500 });
    }
    r.since = state.since ? new Date(state.since).toISOString() : null;
    if (Date.now() - started >= BUDGET_MS) break;
  }
  const caughtUp = streams.every(s => report[s]?.caughtUp);
  return NextResponse.json({ ok: true, caughtUp, rateLimited, report, ...(await store.cuTaskStats()), ms: Date.now() - started });
}
