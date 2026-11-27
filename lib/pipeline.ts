/**
 * Briefs & pipeline: how many briefs each team has, by ClickUp status, against what its editors can finish in a week.
 * Source: the task mirror (cu_tasks): every task in Resilia's live pipeline lists, plus the agency workspace.
 * A brief is "in queue" until its final asset is delivered: no Asset Delivered Date and not closed / done in ClickUp.
 * Team = the board the task lives on (lib/teams boardOf); agency tasks go to <product> Agency.
 */
import { q } from './db';
import { addDays, todayIn } from './dates';
import { PIPELINE_LISTS } from './clickup';
import { TEAMS, boardOf } from './teams';
import { CAPACITY_TZ, buildCapacity, mondayOf } from './capacity';
import { ensureTaskTables } from './store';

export type PipelineTeam = {
  id: string; name: string; group: string;
  queue: number; waiting: number; withEditor: number;
  /** open briefs by ClickUp status, biggest first */
  statuses: { status: string; n: number }[];
  createdInPeriod: number; deliveredInPeriod: number;
  /** finished-edit capacity of the team for one week (null = can't be measured, e.g. agency) */
  weekCapacity: number | null; weeksQueued: number | null;
  oldestDays: number | null; stale: number;
};
export type PipelinePayload = {
  from: string; to: string; today: string; teams: PipelineTeam[];
  totals: { queue: number; waiting: number; withEditor: number; created: number; delivered: number };
  statusOrder: string[];
  mirror: { pipelineSynced: boolean; agencySynced: boolean };
};

const STALE_DAYS = 60;
/** Statuses that are never in the queue: ideas, not briefs in production ("Shelved Ideas", "High Intent Ideas"), and
 * "Final Asset Delivered" even when the Asset Delivered Date wasn't filled in */
const NOT_BRIEFS = '(shelved|ideas?|delivered)\\y'; // Postgres: \y = word boundary

export async function buildPipeline(opts: { from?: string | null; to?: string | null } = {}): Promise<PipelinePayload> {
  await ensureTaskTables();
  const today = todayIn(CAPACITY_TZ);
  const to = opts.to ?? today;
  const from = opts.from ?? `${today.slice(0, 7)}-01`;
  const rows = await q<{
    list_id: string | null; workspace: string; product: string | null; name: string; status: string | null;
    open: boolean; has_editor: boolean; created: boolean; delivered_in: boolean; age_days: number | null; n: number;
  }>(
    `SELECT list_id, workspace, product, min(name) AS name, lower(status) AS status,
            (delivered IS NULL AND closed_at IS NULL AND COALESCE(status_type, '') NOT IN ('closed', 'done') AND COALESCE(status, '') !~* $5) AS open,
            jsonb_array_length(editors) > 0 AS has_editor,
            (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date AS created,
            COALESCE((delivered AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date, false) AS delivered_in,
            max(EXTRACT(day FROM now() - created_at))::int AS age_days,
            COUNT(*)::int AS n
       FROM cu_tasks
      WHERE (workspace = 'resilia' AND list_id = ANY($4::text[])) OR workspace = 'agency'
      GROUP BY 1, 2, 3, 5, 6, 7, 8, 9`,
    [CAPACITY_TZ, from, to, PIPELINE_LISTS, NOT_BRIEFS],
  );
  const stale = await q<{ list_id: string | null; workspace: string; product: string | null; name: string; n: number }>(
    `SELECT list_id, workspace, product, min(name) AS name, COUNT(*)::int AS n FROM cu_tasks
      WHERE ((workspace = 'resilia' AND list_id = ANY($1::text[])) OR workspace = 'agency')
        AND delivered IS NULL AND closed_at IS NULL AND COALESCE(status_type, '') NOT IN ('closed', 'done')
        AND COALESCE(status, '') !~* $3 AND created_at < now() - make_interval(days => $2::int)
      GROUP BY 1, 2, 3`, [PIPELINE_LISTS, STALE_DAYS, NOT_BRIEFS]);

  const cap = await buildCapacity({ week: mondayOf(today) });
  const capBy = new Map(cap.teams.map(t => [t.id, t]));
  const acc = new Map<string, PipelineTeam>();
  const get = (id: string) => {
    let t = acc.get(id);
    if (!t) {
      const team = TEAMS.find(x => x.id === id);
      const c = capBy.get(id);
      const wc = c && c.measured && c.tracked > 0 ? c.weekCapacity : null;
      t = { id, name: team?.name ?? id, group: team?.group ?? '', queue: 0, waiting: 0, withEditor: 0, statuses: [], createdInPeriod: 0,
        deliveredInPeriod: 0, weekCapacity: wc, weeksQueued: null, oldestDays: null, stale: 0 };
      acc.set(id, t);
    }
    return t;
  };
  const statusTotals = new Map<string, number>();
  for (const r of rows) {
    const board = boardOf({ listId: r.list_id, workspace: r.workspace, product: r.product, name: r.name });
    if (!board) continue;
    const t = get(board);
    if (r.created) t.createdInPeriod += r.n;
    if (r.delivered_in) t.deliveredInPeriod += r.n;
    if (!r.open) continue;
    t.queue += r.n;
    if (r.has_editor) t.withEditor += r.n; else t.waiting += r.n;
    const st = r.status ?? 'no status';
    const e = t.statuses.find(x => x.status === st);
    if (e) e.n += r.n; else t.statuses.push({ status: st, n: r.n });
    statusTotals.set(st, (statusTotals.get(st) ?? 0) + r.n);
    t.oldestDays = Math.max(t.oldestDays ?? 0, r.age_days ?? 0);
  }
  for (const r of stale) {
    const board = boardOf({ listId: r.list_id, workspace: r.workspace, product: r.product, name: r.name });
    if (board) get(board).stale += r.n;
  }
  // Every team with a board appears, even with nothing queued
  for (const team of TEAMS) get(team.id);
  const teams = [...acc.values()].map(t => ({
    ...t, statuses: t.statuses.sort((a, b) => b.n - a.n),
    weeksQueued: t.weekCapacity ? Math.round((t.queue / t.weekCapacity) * 10) / 10 : null,
  })).sort((a, b) => TEAMS.findIndex(x => x.id === a.id) - TEAMS.findIndex(x => x.id === b.id));
  const sum = (f: (t: PipelineTeam) => number) => teams.reduce((a, t) => a + f(t), 0);
  const kv = await q<{ key: string; since: string | null }>(`SELECT key, value->>'since' AS since FROM kv WHERE key IN ('tasks_sync_pipeline', 'tasks_sync_agency')`);
  const synced = (k: string) => Number(kv.find(x => x.key === k)?.since ?? 0) > 0;
  return {
    from, to: addDays(to, 0), today, teams,
    totals: { queue: sum(t => t.queue), waiting: sum(t => t.waiting), withEditor: sum(t => t.withEditor), created: sum(t => t.createdInPeriod), delivered: sum(t => t.deliveredInPeriod) },
    statusOrder: [...statusTotals].sort((a, b) => b[1] - a[1]).map(([s]) => s),
    mirror: { pipelineSynced: synced('tasks_sync_pipeline'), agencySynced: synced('tasks_sync_agency') },
  };
}
