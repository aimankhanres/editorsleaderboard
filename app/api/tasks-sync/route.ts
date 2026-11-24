import { NextResponse } from 'next/server';
import { cfg } from '@/lib/config';
import { isCronAuthorized } from '@/lib/auth';
import { editorTasksPage, RateLimited } from '@/lib/clickup';
import * as store from '@/lib/store';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 300;
const BUDGET_MS = 240_000;

/** Paging state kept in kv: pages of "updated after `since`" tasks, oldest first. */
type State = { since: number; page: number; maxSeen: number };

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

  // ?diag=editors : every user found in an Editor field, with task counts (read-only; for mapping the roster)
  if (url.searchParams.get('diag') === 'editors') {
    await store.ensureTaskTables();
    return NextResponse.json(await q(
      `SELECT (e->>'id')::bigint AS id, max(e->>'name') AS name, COUNT(*)::int AS tasks,
              COUNT(*) FILTER (WHERE COALESCE(edit_done, delivered) > now() - interval '30 days')::int AS done30,
              mode() WITHIN GROUP (ORDER BY list_name) AS top_list
         FROM cu_tasks, jsonb_array_elements(editors) e GROUP BY 1 ORDER BY tasks DESC`));
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
  if (url.searchParams.get('diag')) {
    const p = await editorTasksPage(Number(url.searchParams.get('since') ?? 0), Number(url.searchParams.get('page') ?? 0));
    return NextResponse.json({ n: p.tasks.length, lastPage: p.lastPage, sample: p.tasks.slice(0, 3) });
  }

  await store.ensureTaskTables();
  let state = (await store.kvGet<State>('tasks_sync')) ?? { since: 0, page: 0, maxSeen: 0 };
  let pages = 0, saved = 0, passes = 0, rateLimited = false;
  try {
    while (Date.now() - started < BUDGET_MS) {
      const { tasks, lastPage } = await editorTasksPage(state.since, state.page);
      const withEditor = tasks.filter(t => t.editors.length);
      await store.upsertCuTasks(withEditor);
      saved += withEditor.length; pages++;
      const maxSeen = Math.max(state.maxSeen, ...tasks.map(t => t.updated ?? 0));
      // End of this pass: next pass asks for anything updated after the newest update we saw (minus 1s slack)
      state = lastPage ? { since: Math.max(state.since, maxSeen - 1000), page: 0, maxSeen } : { ...state, page: state.page + 1, maxSeen };
      await store.kvSet('tasks_sync', state);
      if (lastPage) { passes++; break; }
    }
  } catch (e) {
    if (e instanceof RateLimited) rateLimited = true;
    else return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), pages, saved }, { status: 500 });
  }
  return NextResponse.json({
    ok: true, pages, saved, caughtUp: passes > 0, rateLimited, state, ...(await store.cuTaskStats()), ms: Date.now() - started,
  });
}
