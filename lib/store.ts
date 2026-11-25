import { q } from './db';
import { cfg } from './config';
import { extractBriefIds } from './briefs';
import { monthStart, nextMonth } from './dates';
import type { AdAgg, BriefInfo, BriefStatus, EditorRef, RosterEntry } from './types';

/** One day of spend for one ad, as fetched from the spend source */
export type AdDayRow = {
  date: string; // YYYY-MM-DD
  adId: string;
  adName: string;
  campaign: string | null;
  adset: string | null;
  channel: string | null;
  spend: number;
  briefIds: string[];
};

const CHUNK = 500;

function chunks<T>(arr: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ---------------------------------------------------------------- ad_spend

export async function upsertAdSpend(rows: AdDayRow[]): Promise<void> {
  for (const part of chunks(rows)) {
    const payload = part.map(r => ({
      spend_date: r.date,
      ad_id: r.adId,
      ad_name: r.adName,
      campaign: r.campaign,
      adset: r.adset,
      channel: r.channel,
      spend: Math.round(r.spend * 100) / 100,
      brief_ids: r.briefIds,
    }));
    await q(
      `INSERT INTO ad_spend (spend_date, ad_id, ad_name, campaign, adset, channel, spend, brief_ids, updated_at)
       SELECT spend_date, ad_id, ad_name, campaign, adset, channel, spend, brief_ids, now()
       FROM jsonb_to_recordset($1::jsonb) AS x(
         spend_date date, ad_id text, ad_name text, campaign text, adset text,
         channel text, spend numeric, brief_ids jsonb)
       ON CONFLICT (spend_date, ad_id) DO UPDATE SET
         ad_name = EXCLUDED.ad_name, campaign = EXCLUDED.campaign, adset = EXCLUDED.adset,
         channel = EXCLUDED.channel, spend = EXCLUDED.spend, brief_ids = EXCLUDED.brief_ids,
         updated_at = now()`,
      [JSON.stringify(payload)],
    );
  }
}

/** Ads with spend in the month, optionally limited to some Triple Whale channels (null = all). */
export function loadMonthAds(month: string, channels: string[] | null = null): Promise<AdAgg[]> {
  return loadAds(monthStart(month), monthStart(nextMonth(month)), channels);
}

/**
 * Ads with spend in [from, toExclusive), summed across days. Name/brief IDs come from the latest day.
 * Optionally limited to some Triple Whale channels (null = all).
 */
export async function loadAds(from: string, toExclusive: string, channels: string[] | null = null): Promise<AdAgg[]> {
  const rows = await q<{ ad_id: string; ad_name: string; campaign: string | null; spend: string; brief_ids: string[] }>(
    `SELECT ad_id,
            (array_agg(ad_name   ORDER BY spend_date DESC))[1] AS ad_name,
            (array_agg(campaign  ORDER BY spend_date DESC))[1] AS campaign,
            (array_agg(brief_ids ORDER BY spend_date DESC))[1] AS brief_ids,
            SUM(spend) AS spend
       FROM ad_spend
      WHERE spend_date >= $1::date AND spend_date < $2::date
        AND ($3::text[] IS NULL OR channel = ANY($3::text[]))
      GROUP BY ad_id
     HAVING SUM(spend) <> 0`,
    [from, toExclusive, channels],
  );
  return rows.map(r => ({
    adId: r.ad_id,
    adName: r.ad_name,
    campaign: r.campaign ?? '',
    spend: Number(r.spend),
    briefIds: Array.isArray(r.brief_ids) ? r.brief_ids : [],
  }));
}

/** First and last day with stored spend (custom ranges can only cover this span) */
export async function dataSpan(): Promise<{ from: string | null; to: string | null }> {
  const rows = await q<{ a: string | null; b: string | null }>(
    `SELECT to_char(MIN(spend_date), 'YYYY-MM-DD') AS a, to_char(MAX(spend_date), 'YYYY-MM-DD') AS b FROM ad_spend`,
  );
  return { from: rows[0]?.a ?? null, to: rows[0]?.b ?? null };
}

export async function monthsAvailable(): Promise<string[]> {
  const rows = await q<{ m: string }>(
    `SELECT DISTINCT to_char(spend_date, 'YYYY-MM') AS m FROM ad_spend ORDER BY m DESC`,
  );
  return rows.map(r => r.m);
}

// ---------------------------------------------------------------- brief_map

/**
 * Brief IDs seen on ads since `fromDate` that need a ClickUp lookup:
 * never looked up, still pending/errored, or older than EDITOR_REFRESH_HOURS.
 * Never-seen briefs come first, then the stalest.
 */
export async function briefsNeedingLookup(fromDate: string, limit: number): Promise<string[]> {
  const rows = await q<{ brief_id: string }>(
    `WITH seen AS (
       SELECT DISTINCT jsonb_array_elements_text(brief_ids) AS brief_id
         FROM ad_spend WHERE spend_date >= $1::date
     )
     SELECT s.brief_id
       FROM seen s LEFT JOIN brief_map b ON b.brief_id = s.brief_id
      WHERE b.brief_id IS NULL
         OR b.status IN ('pending', 'error')
         OR b.fetched_at < now() - make_interval(hours => $2::int)
      ORDER BY (b.brief_id IS NULL) DESC, b.fetched_at ASC NULLS FIRST
      LIMIT $3`,
    [fromDate, Math.max(1, Math.round(cfg.refreshHours)), limit],
  );
  return rows.map(r => r.brief_id);
}

export async function countPendingBriefs(fromDate: string): Promise<number> {
  const rows = await q<{ n: string }>(
    `WITH seen AS (
       SELECT DISTINCT jsonb_array_elements_text(brief_ids) AS brief_id
         FROM ad_spend WHERE spend_date >= $1::date
     )
     SELECT COUNT(*) AS n FROM seen s LEFT JOIN brief_map b ON b.brief_id = s.brief_id
      WHERE b.brief_id IS NULL OR b.status IN ('pending', 'error')`,
    [fromDate],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function upsertBriefs(infos: BriefInfo[]): Promise<void> {
  for (const part of chunks(infos)) {
    const payload = part.map(b => ({
      brief_id: b.briefId,
      task_id: b.taskId,
      task_name: b.taskName,
      task_url: b.taskUrl,
      editors: b.editors,
      status: b.status,
    }));
    await q(
      `INSERT INTO brief_map (brief_id, task_id, task_name, task_url, editors, status, fetched_at)
       SELECT brief_id, task_id, task_name, task_url, editors, status, now()
       FROM jsonb_to_recordset($1::jsonb) AS x(
         brief_id text, task_id text, task_name text, task_url text, editors jsonb, status text)
       ON CONFLICT (brief_id) DO UPDATE SET
         task_id = EXCLUDED.task_id, task_name = EXCLUDED.task_name, task_url = EXCLUDED.task_url,
         editors = EXCLUDED.editors, status = EXCLUDED.status, fetched_at = now()`,
      [JSON.stringify(payload)],
    );
  }
}

/** Queue 6-digit briefs that were "not found" for a fresh lookup (e.g. after adding the resize fallback). */
export async function requeueOtherWorkspaceBriefs(): Promise<number> {
  const rows = await q<{ n: string }>(
    `WITH u AS (UPDATE brief_map SET status = 'pending', fetched_at = 'epoch'
       WHERE brief_id ~ '^[A-Z]+-[0-9]{6,}$' AND (status = 'not_found' OR task_name LIKE 'Via resize:%') RETURNING 1)
     SELECT COUNT(*) AS n FROM u`,
  );
  return Number(rows[0]?.n ?? 0);
}

/** A transient failure: keep the previous editors (if any) but retry next run. */
export async function markBriefsErrored(briefIds: string[]): Promise<void> {
  if (!briefIds.length) return;
  await q(
    `INSERT INTO brief_map (brief_id, status, fetched_at)
     SELECT unnest($1::text[]), 'error', 'epoch'
     ON CONFLICT (brief_id) DO UPDATE SET
       status = CASE WHEN brief_map.status = 'ok' THEN 'ok' ELSE 'error' END,
       fetched_at = 'epoch'`,
    [briefIds],
  );
}

export async function loadBriefMap(briefIds: string[]): Promise<Map<string, BriefInfo>> {
  const map = new Map<string, BriefInfo>();
  if (!briefIds.length) return map;
  await ensureTaskTables();
  const rows = await q<{
    brief_id: string; task_id: string | null; task_name: string | null; task_url: string | null;
    editors: EditorRef[]; status: BriefStatus; list_id: string | null; workspace: string | null; product: string | null;
    strategists: { id: number; name: string }[] | null;
  }>(`SELECT b.brief_id, b.task_id, b.task_name, b.task_url, b.editors, b.status, t.list_id, t.workspace, t.product, t.strategists
        FROM brief_map b LEFT JOIN cu_tasks t ON t.task_id = b.task_id
       WHERE b.brief_id = ANY($1::text[])`, [briefIds]);
  for (const r of rows) {
    map.set(r.brief_id, {
      briefId: r.brief_id, taskId: r.task_id, taskName: r.task_name, taskUrl: r.task_url,
      editors: Array.isArray(r.editors) ? r.editors : [], status: r.status,
      listId: r.list_id, workspace: r.workspace, product: r.product,
      strategists: (r.strategists ?? []).map(u => ({ key: `u:${u.id}`, name: u.name, avatar: null })),
    });
  }
  return map;
}

/** Assets each editor finished in [from, toExclusive) (in `tz`), by board, videos vs statics */
export async function assetsDone(from: string, toExclusive: string, tz: string) {
  await ensureTaskTables();
  return q<{ uid: string; list_id: string | null; workspace: string | null; product: string | null; name: string; statics: number; videos: number }>(
    `SELECT u::text AS uid, list_id, workspace, product, min(name) AS name,
            COUNT(*) FILTER (WHERE st)::int AS statics, COUNT(*) FILTER (WHERE NOT st)::int AS videos
       FROM (SELECT *, (EXISTS (SELECT 1 FROM unnest(sizes) z WHERE z ILIKE 'static%') OR COALESCE(format, '') ILIKE 'static%') AS st
               FROM cu_tasks
              WHERE COALESCE(edit_done, delivered) >= ($1::date)::timestamp AT TIME ZONE $3
                AND COALESCE(edit_done, delivered) <  ($2::date)::timestamp AT TIME ZONE $3) t, unnest(editor_ids) u
      GROUP BY 1, 2, 3, 4`, [from, toExclusive, tz]);
}

/** Webhook: force the next sync to refetch this task. Returns rows touched. */
export async function markTaskStale(taskId: string): Promise<number> {
  const rows = await q(`UPDATE brief_map SET fetched_at = 'epoch' WHERE task_id = $1 RETURNING brief_id`, [taskId]);
  return rows.length;
}

// ---------------------------------------------------------------- editors roster

/** Insert new editors, refresh name/avatar of known ones. Never touches active/display_name. */
export async function upsertEditors(editors: EditorRef[]): Promise<void> {
  const uniq = [...new Map(editors.map(e => [e.key, e])).values()];
  for (const part of chunks(uniq)) {
    await q(
      `INSERT INTO editors (key, name, avatar_url)
       SELECT key, name, avatar FROM jsonb_to_recordset($1::jsonb) AS x(key text, name text, avatar text)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name,
         avatar_url = COALESCE(EXCLUDED.avatar_url, editors.avatar_url)`,
      [JSON.stringify(part.map(e => ({ key: e.key, name: e.name, avatar: e.avatar ?? null })))],
    );
  }
}

export async function loadRoster(): Promise<Map<string, RosterEntry>> {
  const rows = await q<{ key: string; name: string; display_name: string | null; avatar_url: string | null; active: boolean }>(
    `SELECT key, name, display_name, avatar_url, active FROM editors`,
  );
  return new Map(rows.map(r => [r.key, { name: r.display_name || r.name, avatar: r.avatar_url, active: r.active }]));
}

// ---------------------------------------------------------------- snapshots

/** Replace today's snapshot for one channel view. `prefix` is snapPrefix(view): '' for Meta, 'google|', 'all|'. */
export async function writeSnapshot(snapDate: string, month: string, rows: { key: string; spend: number; rank: number }[], prefix = '') {
  await q(
    `DELETE FROM snapshots WHERE snap_date = $1::date AND month = $2
       AND (CASE WHEN $3 = '' THEN position('|' in editor_key) = 0 ELSE starts_with(editor_key, $3) END)`,
    [snapDate, month, prefix],
  );
  rows = rows.map(r => ({ ...r, key: prefix + r.key }));
  for (const part of chunks(rows)) {
    await q(
      `INSERT INTO snapshots (snap_date, month, editor_key, spend, rank)
       SELECT $1::date, $2, key, spend, rank FROM jsonb_to_recordset($3::jsonb) AS x(key text, spend numeric, rank int)`,
      [snapDate, month, JSON.stringify(part.map(r => ({ ...r, spend: Math.round(r.spend * 100) / 100 })))],
    );
  }
}

/** Spend per editor from the most recent snapshot taken before `today` for this month */
export async function previousSpends(month: string, today: string, prefix = ''): Promise<Map<string, number>> {
  const rows = await q<{ editor_key: string; spend: string }>(
    `WITH mine AS (
       SELECT * FROM snapshots WHERE month = $1 AND snap_date < $2::date
          AND (CASE WHEN $3 = '' THEN position('|' in editor_key) = 0 ELSE starts_with(editor_key, $3) END))
     SELECT editor_key, spend FROM mine WHERE snap_date = (SELECT MAX(snap_date) FROM mine)`,
    [month, today, prefix],
  );
  return new Map(rows.map(r => [r.editor_key.slice(prefix.length), Number(r.spend)]));
}

/** Ranks from the most recent snapshot taken before `today` for this month */
export async function previousRanks(month: string, today: string, prefix = ''): Promise<Map<string, number>> {
  const rows = await q<{ editor_key: string; rank: number }>(
    `WITH mine AS (
       SELECT * FROM snapshots WHERE month = $1 AND snap_date < $2::date
          AND (CASE WHEN $3 = '' THEN position('|' in editor_key) = 0 ELSE starts_with(editor_key, $3) END))
     SELECT editor_key, rank FROM mine WHERE snap_date = (SELECT MAX(snap_date) FROM mine)`,
    [month, today, prefix],
  );
  return new Map(rows.map(r => [r.editor_key.slice(prefix.length), r.rank]));
}

// ---------------------------------------------------------------- sync_runs

export async function startSyncRun(): Promise<number> {
  const rows = await q<{ id: string }>(`INSERT INTO sync_runs DEFAULT VALUES RETURNING id`);
  return Number(rows[0].id);
}

export async function finishSyncRun(id: number, r: { ok: boolean; ads: number; lookups: number; pending: number; error?: string | null }) {
  await q(
    `UPDATE sync_runs SET finished_at = now(), ok = $2, ads = $3, lookups = $4, pending = $5, error = $6 WHERE id = $1`,
    [id, r.ok, r.ads, r.lookups, r.pending, r.error ?? null],
  );
}

export async function lastSync(): Promise<{ at: string; ok: boolean; error: string | null } | null> {
  const rows = await q<{ finished_at: string; ok: boolean; error: string | null }>(
    `SELECT finished_at, ok, error FROM sync_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1`,
  );
  if (!rows[0]) return null;
  return { at: new Date(rows[0].finished_at).toISOString(), ok: rows[0].ok, error: rows[0].error };
}

/** Re-run brief extraction on every stored ad name (after the extraction rules change). Returns ads changed. */
export async function reextractBriefIds(): Promise<number> {
  const rows = await q<{ ad_name: string; brief_ids: string[] }>(
    `SELECT DISTINCT ON (ad_name) ad_name, brief_ids FROM ad_spend`,
  );
  const changed = rows
    .map(r => ({ ad_name: r.ad_name, brief_ids: extractBriefIds(r.ad_name) }))
    .filter((r, i) => JSON.stringify(r.brief_ids) !== JSON.stringify(rows[i].brief_ids ?? []));
  for (const part of chunks(changed)) {
    await q(
      `UPDATE ad_spend a SET brief_ids = x.brief_ids, updated_at = now()
         FROM jsonb_to_recordset($1::jsonb) AS x(ad_name text, brief_ids jsonb)
        WHERE a.ad_name = x.ad_name`,
      [JSON.stringify(part)],
    );
  }
  return changed.length;
}

// ---------------------------------------------------------------- ClickUp task mirror

let tasksSchemaReady = false;
/** Task-mirror tables (kept identical to db/schema.sql), created on first use so no manual migration is needed. */
const TASK_DDL = [
  `CREATE TABLE IF NOT EXISTS cu_tasks ( task_id text PRIMARY KEY, name text NOT NULL, url text, list_id text, list_name text, status text, status_type text, editors jsonb NOT NULL DEFAULT '[]', editor_ids bigint[] NOT NULL DEFAULT '{}', brief_id text, edit_done timestamptz, delivered timestamptz, assigned timestamptz, created_at timestamptz, updated_at timestamptz, closed_at timestamptz )`,
  `CREATE INDEX IF NOT EXISTS cu_tasks_editor_idx ON cu_tasks USING gin (editor_ids)`,
  `CREATE INDEX IF NOT EXISTS cu_tasks_done_idx ON cu_tasks (edit_done)`,
  `CREATE INDEX IF NOT EXISTS cu_tasks_hash_idx ON cu_tasks ((substring(name from '^#([0-9]+)')))`,
  `CREATE TABLE IF NOT EXISTS kv (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`,
  `ALTER TABLE cu_tasks ADD COLUMN IF NOT EXISTS workspace text NOT NULL DEFAULT 'resilia'`,
  `ALTER TABLE cu_tasks ADD COLUMN IF NOT EXISTS strategists jsonb NOT NULL DEFAULT '[]'`,
  `ALTER TABLE cu_tasks ADD COLUMN IF NOT EXISTS strategist_ids bigint[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE cu_tasks ADD COLUMN IF NOT EXISTS senior_ids bigint[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE cu_tasks ADD COLUMN IF NOT EXISTS sizes text[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE cu_tasks ADD COLUMN IF NOT EXISTS format text`,
  `ALTER TABLE cu_tasks ADD COLUMN IF NOT EXISTS product text`,
  `ALTER TABLE cu_tasks ADD COLUMN IF NOT EXISTS team text`,
  `ALTER TABLE cu_tasks ADD COLUMN IF NOT EXISTS frame_url text`,
  `ALTER TABLE cu_tasks ADD COLUMN IF NOT EXISTS mirrored_at timestamptz`,
  `CREATE INDEX IF NOT EXISTS cu_tasks_strat_idx ON cu_tasks USING gin (strategist_ids)`,
  `CREATE INDEX IF NOT EXISTS cu_tasks_list_idx ON cu_tasks (list_id)`,
];
export async function ensureTaskTables(): Promise<void> {
  if (tasksSchemaReady) return;
  for (const stmt of TASK_DDL) await q(stmt);
  tasksSchemaReady = true;
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const rows = await q<{ value: T }>(`SELECT value FROM kv WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  await q(`INSERT INTO kv (key, value, updated_at) VALUES ($1, $2::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(value)]);
}

type MirrorRow = import('./clickup').MirroredTask;
const ts = (n: number | null) => (n ? new Date(n).toISOString() : null);

export async function upsertCuTasks(tasks: MirrorRow[]): Promise<void> {
  for (const part of chunks(tasks)) {
    const payload = part.map(t => ({
      task_id: t.taskId, workspace: t.workspace, name: t.name, url: t.url, list_id: t.listId, list_name: t.listName,
      status: t.status, status_type: t.statusType, editors: t.editors, editor_ids: t.editors.map(e => e.id),
      strategists: t.strategists, strategist_ids: t.strategists.map(e => e.id), senior_ids: t.seniors.map(e => e.id),
      brief_id: t.briefId, edit_done: ts(t.editDone), delivered: ts(t.delivered), assigned: ts(t.assigned),
      created_at: ts(t.created), updated_at: ts(t.updated), closed_at: ts(t.closed),
      sizes: t.sizes, format: t.format, product: t.product, team: t.team, frame_url: t.frameUrl,
    }));
    await q(
      `INSERT INTO cu_tasks (task_id, workspace, name, url, list_id, list_name, status, status_type, editors, editor_ids,
                             strategists, strategist_ids, senior_ids, brief_id, edit_done, delivered, assigned,
                             created_at, updated_at, closed_at, sizes, format, product, team, frame_url, mirrored_at)
       SELECT task_id, workspace, name, url, list_id, list_name, status, status_type, editors,
              ARRAY(SELECT jsonb_array_elements_text(editor_ids)::bigint), strategists,
              ARRAY(SELECT jsonb_array_elements_text(strategist_ids)::bigint),
              ARRAY(SELECT jsonb_array_elements_text(senior_ids)::bigint), brief_id,
              edit_done, delivered, assigned, created_at, updated_at, closed_at,
              ARRAY(SELECT jsonb_array_elements_text(sizes)), format, product, team, frame_url, now()
         FROM jsonb_to_recordset($1::jsonb) AS x(task_id text, workspace text, name text, url text, list_id text,
              list_name text, status text, status_type text, editors jsonb, editor_ids jsonb, strategists jsonb,
              strategist_ids jsonb, senior_ids jsonb, brief_id text, edit_done timestamptz, delivered timestamptz,
              assigned timestamptz, created_at timestamptz, updated_at timestamptz, closed_at timestamptz,
              sizes jsonb, format text, product text, team text, frame_url text)
       ON CONFLICT (task_id) DO UPDATE SET workspace = EXCLUDED.workspace, name = EXCLUDED.name, url = EXCLUDED.url,
         list_id = EXCLUDED.list_id, list_name = EXCLUDED.list_name, status = EXCLUDED.status,
         status_type = EXCLUDED.status_type, editors = EXCLUDED.editors, editor_ids = EXCLUDED.editor_ids,
         strategists = EXCLUDED.strategists, strategist_ids = EXCLUDED.strategist_ids, senior_ids = EXCLUDED.senior_ids,
         brief_id = EXCLUDED.brief_id, edit_done = EXCLUDED.edit_done, delivered = EXCLUDED.delivered,
         assigned = EXCLUDED.assigned, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at,
         closed_at = EXCLUDED.closed_at, sizes = EXCLUDED.sizes, format = EXCLUDED.format, product = EXCLUDED.product,
         team = EXCLUDED.team, frame_url = EXCLUDED.frame_url, mirrored_at = now()`,
      [JSON.stringify(payload)],
    );
  }
}

export async function cuTaskStats(): Promise<{ tasks: number; withEditDone: number; newestUpdate: string | null }> {
  const r = await q<{ n: string; d: string; u: string | null }>(
    `SELECT COUNT(*) n, COUNT(edit_done) d, to_char(MAX(updated_at), 'YYYY-MM-DD"T"HH24:MI') u FROM cu_tasks`);
  return { tasks: Number(r[0].n), withEditDone: Number(r[0].d), newestUpdate: r[0].u };
}

/**
 * Resolve internal keys ("AOG#103-W2") from the task mirror: the task whose name starts with "#103_W2" or a size and
 * "#103_W2" ("16x9_#432_W6"; not resize copies like "AOG-29184_r#432_W6") (and names
 * product AOG after "pn"). "Meta Winners Cross Launch" copies are skipped when the original exists; of several,
 * the oldest (original) wins, like duplicate Brief IDs. Tasks with no Editor are not mirrored, so they don't match.
 */
export async function resolveInternalBriefs(keys: string[]): Promise<BriefInfo[]> {
  const { parseInternalKey } = await import('./briefs');
  await ensureTaskTables();
  const out: BriefInfo[] = [];
  for (const key of keys) {
    const k = parseInternalKey(key);
    if (!k) continue;
    const rows = await q<{ task_id: string; name: string; url: string | null; brief_id: string | null; editors: { id: number; name: string }[] }>(
      `SELECT task_id, name, url, brief_id, editors FROM cu_tasks
        WHERE name ~* ('^([0-9]{1,2}x[0-9]{1,2}[_ -]*)?#0*' || $1 || '([^0-9]|$)')
          AND ($2::int IS NULL OR name ~* ('^([0-9]{1,2}x[0-9]{1,2}[_ -]*)?#0*' || $1 || '[_ -]*W ?0*' || $2::text || '([^0-9]|$)'))
          AND ($3::text IS NULL OR name ~* ('pn[^A-Za-z0-9]*' || $3 || '([^A-Za-z]|$)') OR brief_id ILIKE ($3 || '-%'))
          AND jsonb_array_length(editors) > 0 AND workspace = 'resilia'
        ORDER BY (list_name ILIKE '%cross launch%'), created_at NULLS LAST
        LIMIT 1`,
      [String(k.num), k.week, k.product],
    );
    const r = rows[0];
    out.push(r
      ? {
          briefId: key, taskId: r.task_id, taskName: `${r.brief_id ? `${r.brief_id} · ` : ''}${r.name}`,
          taskUrl: r.url ?? `https://app.clickup.com/t/${r.task_id}`,
          editors: r.editors.map(e => ({ key: `u:${e.id}`, name: e.name, avatar: null })), status: 'ok',
        }
      : { briefId: key, taskId: null, taskName: null, taskUrl: null, editors: [], status: 'not_found' });
  }
  return out;
}

/** Queue internal keys that were not found (e.g. before the task mirror finished its first backfill). */
export async function requeueInternalBriefs(): Promise<number> {
  const rows = await q<{ n: string }>(
    `WITH u AS (UPDATE brief_map SET status = 'pending', fetched_at = 'epoch'
       WHERE brief_id ~ '^[A-Z]*#[0-9]+(-W[0-9]+)?$' AND brief_id !~ '^#[0-9]+$' RETURNING 1)
     SELECT COUNT(*) AS n FROM u`,
  );
  return Number(rows[0]?.n ?? 0);
}
