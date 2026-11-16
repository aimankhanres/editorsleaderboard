/**
 * Triple Whale: Meta ad-level daily spend.
 *
 * From the docs (triplewhale.readme.io/reference/data-out-execute-custom-sql-query, docs/ads-table), Nov 2026:
 *   POST https://api.triplewhale.com/api/v2/orcabase/api/sql   header x-api-key
 *   body { shopId, query, period: { startDate, endDate } }  ->  { data: [...] }
 *   Table ads_table: event_date, channel, campaign_name, adset_name, ad_id, ad_name, spend. Meta = 'facebook-ads'.
 *   Engine is ClickHouse. Rate limit 600/min. Row limits are not documented, so we query one month at a time.
 * NOT yet tested against a live key: run `GET /api/sync?dry=1` first and compare totals with Ads Manager.
 *
 * Swap this file for a Meta Marketing API (/insights?level=ad) client if needed; it only has to
 * return AdDayRow[].
 */
import { cfg } from './config';
import { extractBriefIds } from './briefs';
import { monthOf, monthStart, nextMonth } from './dates';
import type { AdDayRow } from './store';

type TwRow = {
  day: string;
  ad: string | number;
  name: string | null;
  campaign: string | null;
  adset: string | null;
  total_spend: number | string | null;
};

const sqlString = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// Group by day + ad only (never by ad set/campaign), so each ad is counted once per day.
// ClickHouse puts SELECT aliases in scope for WHERE/GROUP BY, so aliases must not reuse column
// names (e.g. `SUM(spend) AS spend` breaks the filters). Columns are qualified with `a.`.
const QUERY = (channel: string) => `
SELECT
  toString(a.event_date) AS day,
  toString(a.ad_id)      AS ad,
  any(a.ad_name)         AS name,
  any(a.campaign_name)   AS campaign,
  any(a.adset_name)      AS adset,
  SUM(a.spend)           AS total_spend
FROM ads_table a
WHERE a.event_date BETWEEN @startDate AND @endDate
  AND a.channel = ${sqlString(channel)}
  AND a.ad_id IS NOT NULL AND a.ad_id != ''
GROUP BY a.event_date, a.ad_id
`;

/** Triple Whale's own documented example query: tells "bad query" apart from "bad key / shop". */
const PROBE_QUERY = 'SELECT SUM(spend) AS spend, channel FROM ads_table a WHERE event_date BETWEEN @startDate AND @endDate GROUP BY channel';

async function runQuery<T = TwRow>(startDate: string, endDate: string, query: string = QUERY(cfg.tw.channel)): Promise<T[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${cfg.tw.base}/orcabase/api/sql`, {
      method: 'POST',
      headers: { 'x-api-key': cfg.tw.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopId: cfg.tw.shopId,
        query,
        period: { startDate, endDate },
      }),
      cache: 'no-store',
    });
    if (res.status === 429 && attempt < 2) {
      const wait = Number(res.headers.get('retry-after') ?? 5);
      await new Promise(r => setTimeout(r, Math.min(wait, 20) * 1000));
      continue;
    }
    const text = await res.text();
    let body: { data?: T[]; message?: string; error?: string } | null = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok || !body || !Array.isArray(body.data)) {
      // Include a short snippet of the response so failures are diagnosable (never contains our key).
      const detail = body?.message ?? body?.error ?? text.slice(0, 300) ?? 'empty response';
      throw new Error(`Triple Whale ${res.status}: ${detail}`);
    }
    return body.data;
  }
  throw new Error('Triple Whale: rate limited');
}

/** Ad-level daily spend for [from, to] inclusive (YYYY-MM-DD), one request per calendar month. */
export async function fetchAdSpend(from: string, to: string): Promise<AdDayRow[]> {
  if (!cfg.tw.apiKey || !cfg.tw.shopId) throw new Error('TRIPLEWHALE_API_KEY / TRIPLEWHALE_SHOP_ID not set');
  const out: AdDayRow[] = [];
  let month = monthOf(from);
  while (monthStart(month) <= to) {
    const start = monthStart(month) < from ? from : monthStart(month);
    const lastDay = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
    const end = lastDay > to ? to : lastDay;
    for (const r of await runQuery(start, end)) {
      const adName = r.name ?? '';
      out.push({
        date: String(r.day).slice(0, 10),
        adId: String(r.ad),
        adName,
        campaign: r.campaign,
        adset: r.adset,
        channel: cfg.tw.channel,
        spend: Number(r.total_spend ?? 0) || 0,
        briefIds: extractBriefIds(adName),
      });
    }
    month = nextMonth(month);
  }
  return out;
}

/** Runs the documented example query; returns spend per channel or the error text. */
export async function probe(from: string, to: string): Promise<unknown> {
  try {
    return await runQuery<Record<string, unknown>>(from, to, PROBE_QUERY);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
