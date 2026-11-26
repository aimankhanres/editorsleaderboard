import { NextResponse } from 'next/server';
import { cfg } from '@/lib/config';
import { isCronAuthorized } from '@/lib/auth';
import { agencyAccessCheck, agencyToken, liveEditorTasks, liveTaskEditors, timeInStatus, workspaceUsers, editorTasksPage, RateLimited, streamTasksPage, type MirrorStream } from '@/lib/clickup';
import * as store from '@/lib/store';
import { q } from '@/lib/db';
import { emailHash } from '@/lib/pods';

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
  // ?diag=capaudit&ids=1,2&month=YYYY-MM : read-only audit. Each editor's finished edits in the month, re-counted LIVE
  // from ClickUp (Editor field, Edit Complete or Asset Delivered date, Pakistan time) vs the dashboard's task mirror.
  if (url.searchParams.get('diag') === 'capaudit') {
    await store.ensureTaskTables();
    const month = url.searchParams.get('month') ?? new Date().toISOString().slice(0, 7);
    const ids = (url.searchParams.get('ids') ?? '').split(',').map(Number).filter(Boolean);
    const pk = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
    const since = Date.parse(`${month}-01T00:00:00Z`) - 2 * 864e5;
    const out = [];
    for (const id of ids) {
      if (Date.now() - started > 270_000) { out.push({ id, skipped: 'time budget' }); continue; }
      try {
        const live = (await liveEditorTasks(id, since)).filter(t => { const d = t.editDone ?? t.delivered; return d != null && pk(d).startsWith(month); });
        const mirror = await q<{ task_id: string }>(
          `SELECT task_id FROM cu_tasks WHERE $1::bigint = ANY(editor_ids)
              AND to_char((COALESCE(edit_done, delivered) AT TIME ZONE 'Asia/Karachi')::date, 'YYYY-MM') = $2`, [id, month]);
        const L = new Set(live.map(t => t.taskId)), M = new Set(mirror.map(r => r.task_id));
        out.push({ id, live: L.size, dashboard: M.size, missingFromDashboard: [...L].filter(x => !M.has(x)), extraOnDashboard: [...M].filter(x => !L.has(x)) });
      } catch (e) { out.push({ id, error: e instanceof Error ? e.message : String(e) }); }
    }
    return NextResponse.json({ month, results: out, ms: Date.now() - started });
  }
  // ?diag=briefaudit&month=YYYY-MM&live=60 : read-only audit. Every brief with spend: its ClickUp task and Editor in the
  // dashboard's lookup table vs the task mirror; the top `live` briefs by spend are also checked live against ClickUp.
  if (url.searchParams.get('diag') === 'briefaudit') {
    await store.ensureTaskTables();
    const month = url.searchParams.get('month') ?? new Date().toISOString().slice(0, 7);
    const liveN = Math.min(150, Number(url.searchParams.get('live') ?? 60));
    const rows = await q<{ brief_id: string; spend: number; status: string | null; task_id: string | null; task_name: string | null;
      map_eds: number[] | null; mirror_eds: number[] | null; mirror_brief: string | null; in_mirror: boolean }>(
      `WITH sp AS (
         SELECT b AS brief_id, sum(a.spend / jsonb_array_length(a.brief_ids))::float spend
           FROM ad_spend a, jsonb_array_elements_text(a.brief_ids) b
          WHERE a.spend_date >= ($1 || '-01')::date AND a.spend_date < (($1 || '-01')::date + interval '1 month') GROUP BY 1)
       SELECT sp.brief_id, sp.spend, m.status, m.task_id, m.task_name,
              ARRAY(SELECT (e->>'key') FROM jsonb_array_elements(COALESCE(m.editors, '[]')) e) AS map_eds_raw,
              (SELECT array_agg(x ORDER BY x) FROM unnest(t.editor_ids) x) mirror_eds, t.brief_id mirror_brief, t.task_id IS NOT NULL in_mirror
         FROM sp LEFT JOIN brief_map m ON m.brief_id = sp.brief_id LEFT JOIN cu_tasks t ON t.task_id = m.task_id
        ORDER BY sp.spend DESC`, [month]);
    type R = typeof rows[number] & { map_eds_raw?: string[] };
    const ids = (r: R) => (r.map_eds_raw ?? []).map(k => Number(String(k).replace(/^u:/, ''))).filter(Boolean).sort((a, b) => a - b);
    const ok = rows.filter(r => r.status === 'ok') as R[];
    const viaResize = (r: R) => (r.task_name ?? '').startsWith('Via resize');
    const mismatch = ok.filter(r => !viaResize(r) && r.in_mirror && JSON.stringify(ids(r)) !== JSON.stringify((r.mirror_eds ?? []).map(Number)));
    const notInMirror = ok.filter(r => !viaResize(r) && !r.in_mirror);
    const liveChecks = [];
    for (const r of ok.filter(x => !viaResize(x) && x.task_id).slice(0, liveN)) {
      if (Date.now() - started > 270_000) break;
      const live = await liveTaskEditors(r.task_id!, 'resilia');
      const want = ids(r);
      liveChecks.push({ brief: r.brief_id, spend: Math.round(r.spend), task: r.task_id, live: live?.sort((a, b) => a - b) ?? null, dashboard: want,
        match: live != null && JSON.stringify(live) === JSON.stringify(want) });
    }
    const sum = (xs: R[]) => Math.round(xs.reduce((a, r) => a + r.spend, 0));
    return NextResponse.json({
      month, briefs: rows.length, byStatus: Object.fromEntries([...new Set(rows.map(r => r.status ?? 'none'))].map(s => [s, { briefs: rows.filter(r => (r.status ?? 'none') === s).length, spend: sum(rows.filter(r => (r.status ?? 'none') === s) as R[]) }])),
      editorMismatchVsMirror: { count: mismatch.length, spend: sum(mismatch), sample: mismatch.slice(0, 25).map(r => ({ brief: r.brief_id, spend: Math.round(r.spend), task: r.task_id, dashboard: ids(r), mirror: r.mirror_eds })) },
      taskNotInMirror: { count: notInMirror.length, spend: sum(notInMirror), sample: notInMirror.slice(0, 15).map(r => ({ brief: r.brief_id, task: r.task_id })) },
      live: { checked: liveChecks.length, mismatches: liveChecks.filter(c => !c.match) },
      ms: Date.now() - started,
    });
  }
  // ?diag=edits&id=<clickup user>&month=YYYY-MM : every task counted as that person's finished edit in the month (read-only)
  if (url.searchParams.get('diag') === 'edits') {
    const month = url.searchParams.get('month') ?? new Date().toISOString().slice(0, 7);
    return NextResponse.json(await q(
      `SELECT task_id, workspace, list_name, status, name, url, jsonb_array_length(editors) n_editors,
              (SELECT string_agg(e->>'name', ' / ') FROM jsonb_array_elements(editors) e) editors,
              to_char(edit_done AT TIME ZONE 'Asia/Karachi', 'MM-DD HH24:MI') edit_done,
              to_char(delivered AT TIME ZONE 'Asia/Karachi', 'MM-DD HH24:MI') delivered,
              to_char(created_at, 'YYYY-MM-DD') created, revisions
         FROM cu_tasks
        WHERE $1::bigint = ANY(editor_ids)
          AND COALESCE(edit_done, delivered) >= (($2 || '-01')::date)::timestamp AT TIME ZONE 'Asia/Karachi'
          AND COALESCE(edit_done, delivered) <  ((($2 || '-01')::date + interval '1 month'))::timestamp AT TIME ZONE 'Asia/Karachi'
        ORDER BY COALESCE(edit_done, delivered)`, [Number(url.searchParams.get('id')), month]));
  }
  // ?diag=revisions : how "Total Revisions" and time in revision statuses are spread for edits finished this month (read-only)
  if (url.searchParams.get('diag') === 'revisions') {
    return NextResponse.json(await q(
      `SELECT workspace, revisions, COUNT(*)::int n,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(status_time, '{}')) e WHERE e.key ~* 'revision' AND e.value::numeric > 0))::int AS had_revision_status
         FROM cu_tasks WHERE jsonb_array_length(editors) > 0 AND COALESCE(edit_done, delivered) >= date_trunc('month', now())
        GROUP BY 1, 2 ORDER BY 1, 2`));
  }
  // ?diag=agencydates : which completion dates agency tasks carry, by status (read-only)
  if (url.searchParams.get('diag') === 'agencydates') {
    await store.ensureTaskTables();
    return NextResponse.json(await q(
      `SELECT lower(status) status, status_type, COUNT(*)::int n, COUNT(edit_done)::int edit_done, COUNT(delivered)::int delivered,
              COUNT(closed_at)::int closed, COUNT(assigned)::int assigned, COUNT(*) FILTER (WHERE jsonb_array_length(editors) > 0)::int with_editor,
              to_char(max(updated_at), 'MM-DD') last_update
         FROM cu_tasks WHERE workspace = 'agency' GROUP BY 1, 2 ORDER BY n DESC`));
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
  // Time in each status for recently finished tasks (bonus scorecards: revision and review turnaround), 100 per call
  const tis: Record<string, { tasks: number; error?: string }> = {};
  const wss: ('resilia' | 'agency')[] = agencyToken() ? ['resilia', 'agency'] : ['resilia'];
  for (const ws of wss) {
    tis[ws] = { tasks: 0 };
    try {
      for (let i = 0; i < 20 && Date.now() - started < 270_000; i++) {
        const ids = await store.tasksNeedingStatusTime(ws, 100);
        if (!ids.length) break;
        const map = await timeInStatus(ids, ws);
        // tasks ClickUp returned nothing for still get a stamp, so they aren't asked for again until they change
        for (const id of ids) if (!map.has(id)) map.set(id, {});
        await store.saveStatusTime(map);
        tis[ws].tasks += ids.length;
      }
    } catch (e) { tis[ws].error = e instanceof Error ? e.message : String(e); }
  }

  // Workspace members with emails (to match ClickUp Strategist users to the pod list), refreshed once a day
  const users = await store.kvGet<{ at: number }>('cu_users');
  if (!users || Date.now() - users.at > 864e5 || url.searchParams.get('users')) {
    try {
      // Only a one-way hash of each email is kept (enough to match people to the pod list)
      const list = await workspaceUsers();
      const hashed = await Promise.all(list.map(async u => ({ id: u.id, name: u.name, hash: u.email ? await emailHash(u.email) : null })));
      await store.kvSet('cu_users', { at: Date.now(), users: hashed });
    } catch (e) { console.error('users', e); }
  }
  return NextResponse.json({ ok: true, caughtUp, rateLimited, report, timeInStatus: tis, ...(await store.cuTaskStats()), ms: Date.now() - started });
}
