/**
 * Missing editors: tasks in Resilia's live ClickUp boards whose Editor field is empty although someone should be on
 * it: the task has ad spend (credit is lost), its edit is finished or delivered (capacity is lost), or it has moved
 * past the brief stage. Tasks still being briefed ("task created", "brief in progress", idea statuses) are left out.
 */
import { q } from './db';
import { PIPELINE_LISTS } from './clickup';
import { TEAMS, boardOf } from './teams';
import { ensureTaskTables } from './store';

export type MissingReason = 'spend' | 'finished' | 'in_progress';
export type MissingTask = {
  taskId: string; name: string; url: string; board: string; list: string | null; status: string | null;
  briefId: string | null; spend: number; spendMonth: number; finished: string | null; created: string | null;
  reasons: MissingReason[];
};

/** Statuses where no editor is expected yet */
const NOT_YET = '(task created|brief in progress|brief complete|to do|backlog|ideas?\\y|shelved|on hold|rejected)';

export async function buildMissing(): Promise<{ tasks: MissingTask[]; month: string }> {
  await ensureTaskTables();
  const month = new Date().toISOString().slice(0, 7);
  const rows = await q<{
    task_id: string; name: string; url: string | null; list_id: string | null; list_name: string | null; status: string | null;
    status_type: string | null; brief_id: string | null; finished: string | null; created: string | null;
    spend: number | null; spend_month: number | null;
  }>(
    `WITH sp AS (
       SELECT b AS brief_id, sum(a.spend / jsonb_array_length(a.brief_ids))::float AS spend,
              sum(a.spend / jsonb_array_length(a.brief_ids)) FILTER (WHERE a.spend_date >= ($3 || '-01')::date)::float AS spend_month
         FROM ad_spend a, jsonb_array_elements_text(a.brief_ids) b GROUP BY 1)
     SELECT t.task_id, t.name, t.url, t.list_id, t.list_name, t.status, t.status_type,
            COALESCE(upper(substring(t.name from 'r((?:OO|AOG|CIN)-[0-9]{4,})')), t.brief_id) AS brief_id,
            to_char(COALESCE(t.edit_done, t.delivered), 'YYYY-MM-DD') AS finished,
            to_char(t.created_at, 'YYYY-MM-DD') AS created, sp.spend, sp.spend_month
       FROM cu_tasks t
       -- a resize task's ads carry the ORIGINAL brief ("16x9_AOG-28165_rAOG-100721_…"): count that brief's spend
       LEFT JOIN sp ON sp.brief_id = COALESCE(upper(substring(t.name from 'r((?:OO|AOG|CIN)-[0-9]{4,})')), upper(t.brief_id))
      WHERE t.workspace = 'resilia' AND t.list_id = ANY($1::text[]) AND jsonb_array_length(t.editors) = 0
        AND COALESCE(t.status, '') !~* 'rejected'
        AND (COALESCE(sp.spend, 0) > 0 OR t.edit_done IS NOT NULL OR t.delivered IS NOT NULL
             OR (COALESCE(t.status, '') !~* $2 AND COALESCE(t.status_type, '') NOT IN ('open', 'unstarted')))`,
    [PIPELINE_LISTS, NOT_YET, month]);
  const teamName = new Map(TEAMS.map(t => [t.id, t.name]));
  const tasks: MissingTask[] = rows.map(r => {
    const reasons: MissingReason[] = [];
    if ((r.spend ?? 0) > 0) reasons.push('spend');
    if (r.finished) reasons.push('finished');
    if (!reasons.length) reasons.push('in_progress');
    const board = boardOf({ listId: r.list_id, workspace: 'resilia' });
    return {
      taskId: r.task_id, name: r.name, url: r.url ?? `https://app.clickup.com/t/${r.task_id}`,
      board: board ? teamName.get(board) ?? board : r.list_name ?? 'Other', list: r.list_name, status: r.status,
      briefId: r.brief_id, spend: Math.round((r.spend ?? 0) * 100) / 100, spendMonth: Math.round((r.spend_month ?? 0) * 100) / 100,
      finished: r.finished, created: r.created, reasons,
    };
  }).sort((a, b) => b.spend - a.spend || (b.finished ?? '').localeCompare(a.finished ?? '') || a.name.localeCompare(b.name));
  return { tasks, month };
}
