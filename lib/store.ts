import { q } from './db';
import { cfg } from './config';
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

/** All ads with spend in the month, summed across days. Name/brief IDs come from the latest day. */
export async function loadMonthAds(month: string): Promise<AdAgg[]> {
  const rows = await q<{ ad_id: string; ad_name: string; campaign: string | null; spend: string; brief_ids: string[] }>(
    `SELECT ad_id,
            (array_agg(ad_name   ORDER BY spend_date DESC))[1] AS ad_name,
            (array_agg(campaign  ORDER BY spend_date DESC))[1] AS campaign,
            (array_agg(brief_ids ORDER BY spend_date DESC))[1] AS brief_ids,
            SUM(spend) AS spend
       FROM ad_spend
      WHERE spend_date >= $1::date AND spend_date < $2::date
      GROUP BY ad_id
     HAVING SUM(spend) <> 0`,
    [monthStart(month), monthStart(nextMonth(month))],
  );
  return rows.map(r => ({
    adId: r.ad_id,
    adName: r.ad_name,
    campaign: r.campaign ?? '',
    spend: Number(r.spend),
    briefIds: Array.isArray(r.brief_ids) ? r.brief_ids : [],
  }));
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
  const rows = await q<{
    brief_id: string; task_id: string | null; task_name: string | null; task_url: string | null;
    editors: EditorRef[]; status: BriefStatus;
  }>(`SELECT brief_id, task_id, task_name, task_url, editors, status FROM brief_map WHERE brief_id = ANY($1::text[])`, [briefIds]);
  for (const r of rows) {
    map.set(r.brief_id, {
      briefId: r.brief_id, taskId: r.task_id, taskName: r.task_name, taskUrl: r.task_url,
      editors: Array.isArray(r.editors) ? r.editors : [], status: r.status,
    });
  }
  return map;
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

export async function writeSnapshot(snapDate: string, month: string, rows: { key: string; spend: number; rank: number }[]) {
  await q(`DELETE FROM snapshots WHERE snap_date = $1::date AND month = $2`, [snapDate, month]);
  for (const part of chunks(rows)) {
    await q(
      `INSERT INTO snapshots (snap_date, month, editor_key, spend, rank)
       SELECT $1::date, $2, key, spend, rank FROM jsonb_to_recordset($3::jsonb) AS x(key text, spend numeric, rank int)`,
      [snapDate, month, JSON.stringify(part.map(r => ({ ...r, spend: Math.round(r.spend * 100) / 100 })))],
    );
  }
}

/** Ranks from the most recent snapshot taken before `today` for this month */
export async function previousRanks(month: string, today: string): Promise<Map<string, number>> {
  const rows = await q<{ editor_key: string; rank: number }>(
    `SELECT editor_key, rank FROM snapshots
      WHERE month = $1 AND snap_date = (
        SELECT MAX(snap_date) FROM snapshots WHERE month = $1 AND snap_date < $2::date)`,
    [month, today],
  );
  return new Map(rows.map(r => [r.editor_key, r.rank]));
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
