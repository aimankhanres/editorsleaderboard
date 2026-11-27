/**
 * Triple Whale: ad-level daily spend for the channels in lib/channels.ts (Meta, Google video).
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
import { CHANNELS, type Channel } from './channels';
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
const QUERY = (channel: string, campaignTypes: string[] | null = null) => `
SELECT
  toString(a.event_date) AS day,
  toString(a.ad_id)      AS ad,
  any(a.ad_name)         AS name,
  any(a.campaign_name)   AS campaign,
  any(a.adset_name)      AS adset,
  SUM(a.spend)           AS total_spend
FROM ads_table a
WHERE a.event_date BETWEEN @startDate AND @endDate
  AND a.channel = ${sqlString(channel)}${campaignTypes ? `
  AND a.campaign_type IN (${campaignTypes.map(sqlString).join(', ')})` : ''}
  AND a.ad_id IS NOT NULL AND a.ad_id != ''
GROUP BY a.event_date, a.ad_id
HAVING SUM(a.spend) != 0
ORDER BY ad
`;
// The API rejects large result sets with a bare "400: An error occurred", so we query one day at a
// time and page through it.
const PAGE = 1000;

/** Triple Whale's own documented example query: tells "bad query" apart from "bad key / shop". */
const PROBE_QUERY = 'SELECT SUM(spend) AS spend, channel FROM ads_table a WHERE event_date BETWEEN @startDate AND @endDate GROUP BY channel';

async function runQuery<T = TwRow>(startDate: string, endDate: string, query: string = QUERY(cfg.tw.channel)): Promise<T[]> {
  for (let attempt = 0; attempt < 5; attempt++) {
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
    if (res.status === 429 && attempt < 4) {
      // rate limited: wait as asked (or back off 5s, 10s, 20s, 30s) and try again
      const wait = Number(res.headers.get('retry-after') ?? 5 * 2 ** attempt);
      await new Promise(r => setTimeout(r, Math.min(wait, 30) * 1000));
      continue;
    }
    const text = await res.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    // The live API returns a bare array of rows; the docs show { data: [...] }. Accept both.
    const rows = Array.isArray(body) ? body : (body as { data?: unknown })?.data;
    if (res.ok && Array.isArray(rows)) return rows as T[];
    // Include a short snippet of the response so failures are diagnosable (never contains our key).
    const b = body as { message?: string; error?: string } | null;
    const detail = b?.message ?? b?.error ?? (text.slice(0, 300) || 'empty response');
    throw new Error(`Triple Whale ${res.status}: ${detail}`);
  }
  throw new Error('Triple Whale: rate limited');
}

/** Ad-level daily spend for [from, to] inclusive (YYYY-MM-DD), every channel, fetched in parallel. */
export async function fetchAdSpend(from: string, to: string, channels: Channel[] = CHANNELS): Promise<AdDayRow[]> {
  if (!cfg.tw.apiKey || !cfg.tw.shopId) throw new Error('TRIPLEWHALE_API_KEY / TRIPLEWHALE_SHOP_ID not set');
  return (await Promise.all(channels.map(c => fetchChannel(c, from, to)))).flat();
}

/** One channel: one day per request, paged. */
async function fetchChannel(ch: Channel, from: string, to: string): Promise<AdDayRow[]> {
  const out: AdDayRow[] = [];
  for (const day of daysBetween(from, to)) {
    for (let offset = 0; ; offset += PAGE) {
      const rows = await runQuery(day, day, `${QUERY(ch.tw, ch.campaignTypes)} LIMIT ${PAGE} OFFSET ${offset}`);
      for (const r of rows) {
        const adName = r.name ?? '';
        out.push({
          date: String(r.day).slice(0, 10),
          adId: `${ch.adIdPrefix}${r.ad}`,
          adName,
          campaign: r.campaign,
          adset: r.adset,
          channel: ch.tw,
          spend: Number(r.total_spend ?? 0) || 0,
          briefIds: extractBriefIds(adName),
        });
      }
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/** Runs the documented example query; returns spend per channel or the error text. */
export async function probe(from: string, to: string): Promise<unknown> {
  return tryQuery(from, to, PROBE_QUERY);
}

async function tryQuery(from: string, to: string, query: string): Promise<unknown> {
  try {
    const rows = await runQuery<Record<string, unknown>>(from, to, query);
    return { ok: true, rows: rows.length, sample: rows.slice(0, 2) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Diagnostics: runs variants of the ad-level query, adding one feature at a time, to find what the API rejects. */
export async function diagnose(from: string, to: string): Promise<Record<string, unknown>> {
  const ch = sqlString(cfg.tw.channel);
  const variants: Record<string, string> = {
    '1_minimal': `SELECT ad_id, SUM(spend) AS total_spend FROM ads_table WHERE event_date BETWEEN @startDate AND @endDate AND channel = ${ch} GROUP BY ad_id LIMIT 3`,
    '2_by_day': `SELECT event_date, ad_id, SUM(spend) AS total_spend FROM ads_table WHERE event_date BETWEEN @startDate AND @endDate AND channel = ${ch} GROUP BY event_date, ad_id LIMIT 3`,
    '3_alias_a': `SELECT a.event_date, a.ad_id, SUM(a.spend) AS total_spend FROM ads_table a WHERE a.event_date BETWEEN @startDate AND @endDate AND a.channel = ${ch} GROUP BY a.event_date, a.ad_id LIMIT 3`,
    '4_any_name': `SELECT event_date, ad_id, any(ad_name) AS ad_label, SUM(spend) AS total_spend FROM ads_table WHERE event_date BETWEEN @startDate AND @endDate AND channel = ${ch} GROUP BY event_date, ad_id LIMIT 3`,
    '5_name_in_group': `SELECT event_date, ad_id, ad_name, campaign_name, adset_name, SUM(spend) AS total_spend FROM ads_table WHERE event_date BETWEEN @startDate AND @endDate AND channel = ${ch} GROUP BY event_date, ad_id, ad_name, campaign_name, adset_name LIMIT 3`,
    '6_tostring': `SELECT toString(event_date) AS day, ad_id, SUM(spend) AS total_spend FROM ads_table WHERE event_date BETWEEN @startDate AND @endDate AND channel = ${ch} GROUP BY event_date, ad_id LIMIT 3`,
    '7_ad_id_filter': `SELECT event_date, ad_id, SUM(spend) AS total_spend FROM ads_table WHERE event_date BETWEEN @startDate AND @endDate AND channel = ${ch} AND ad_id != '' GROUP BY event_date, ad_id LIMIT 3`,
    '8_full': QUERY(cfg.tw.channel) + ' LIMIT 3',
    '9_full_day_page': QUERY(cfg.tw.channel) + ` LIMIT ${PAGE}`,
  };
  const out: Record<string, unknown> = {};
  for (const [k, q] of Object.entries(variants)) out[k] = await tryQuery(from, to, q);
  return out;
}

type AdTotalRow = { ad: string; name: string | null; campaign: string | null; ctype: string | null; total_spend: number | string | null };

/**
 * Diagnostics (read-only): spend per ad for any channel over [from, to], paged. Used to check whether
 * another channel (e.g. google-ads) has brief IDs in its ad names before adding it to the leaderboard.
 */
export async function adTotals(channel: string, from: string, to: string) {
  const out: { adId: string; adName: string; campaign: string | null; campaignType: string | null; spend: number }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await runQuery<AdTotalRow>(from, to, `
SELECT toString(a.ad_id) AS ad, any(a.ad_name) AS name, any(a.campaign_name) AS campaign,
       any(a.campaign_type) AS ctype, SUM(a.spend) AS total_spend
FROM ads_table a
WHERE a.event_date BETWEEN @startDate AND @endDate AND a.channel = ${sqlString(channel)}
GROUP BY a.ad_id
HAVING SUM(a.spend) != 0
ORDER BY ad
LIMIT ${PAGE} OFFSET ${offset}`);
    for (const r of rows) {
      out.push({ adId: String(r.ad), adName: r.name ?? '', campaign: r.campaign, campaignType: r.ctype, spend: Number(r.total_spend ?? 0) || 0 });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Audit (read-only): per day, the number of ads with spend and their spend, rounded to the cent per ad per day exactly
 * as stored (ad_spend keeps numeric(14,2)). Same filters as the sync: ad level, non-empty ad id, non-zero spend.
 */
export async function dailyTotals(channel: string, campaignTypes: string[] | null, from: string, to: string) {
  const rows = await runQuery<{ d: string; n: number | string; t: number | string }>(from, to, `
SELECT toString(x.dd) AS d, count() AS n, sum(round(x.s, 2)) AS t
FROM (
  SELECT a.event_date AS dd, a.ad_id AS aid, SUM(a.spend) AS s
  FROM ads_table a
  WHERE a.event_date BETWEEN @startDate AND @endDate
    AND a.channel = ${sqlString(channel)}${campaignTypes ? `
    AND a.campaign_type IN (${campaignTypes.map(sqlString).join(', ')})` : ''}
    AND a.ad_id IS NOT NULL AND a.ad_id != ''
  GROUP BY a.event_date, a.ad_id
  HAVING SUM(a.spend) != 0
) x
GROUP BY x.dd
ORDER BY d`);
  return rows.map(r => ({ day: String(r.d).slice(0, 10), ads: Number(r.n), spend: Math.round(Number(r.t) * 100) / 100 }));
}

/** Audit (read-only): every ad's spend on one day, rounded to the cent */
export async function adsOnDay(channel: string, campaignTypes: string[] | null, day: string) {
  const out: { adId: string; name: string; spend: number }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await runQuery<{ ad: string; name: string | null; s: number | string }>(day, day, `
SELECT toString(a.ad_id) AS ad, any(a.ad_name) AS name, round(SUM(a.spend), 2) AS s
FROM ads_table a
WHERE a.event_date BETWEEN @startDate AND @endDate AND a.channel = ${sqlString(channel)}${campaignTypes ? `
  AND a.campaign_type IN (${campaignTypes.map(sqlString).join(', ')})` : ''}
  AND a.ad_id IS NOT NULL AND a.ad_id != ''
GROUP BY a.ad_id HAVING SUM(a.spend) != 0
ORDER BY ad LIMIT ${PAGE} OFFSET ${offset}`);
    for (const r of rows) out.push({ adId: String(r.ad), name: r.name ?? '', spend: Number(r.s) });
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Audit (read-only): spend per ad over [from, to], rounded to the cent per ad per day first (exactly as stored) */
export async function adTotalsDaily(channel: string, campaignTypes: string[] | null, from: string, to: string) {
  const out: { adId: string; adName: string; spend: number }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await runQuery<{ ad: string; nm: string | null; t: number | string }>(from, to, `
SELECT toString(x.aid) AS ad, any(x.nm0) AS nm, sum(round(x.s, 2)) AS t
FROM (
  SELECT a.event_date AS dd, a.ad_id AS aid, any(a.ad_name) AS nm0, SUM(a.spend) AS s
  FROM ads_table a
  WHERE a.event_date BETWEEN @startDate AND @endDate AND a.channel = ${sqlString(channel)}${campaignTypes ? `
    AND a.campaign_type IN (${campaignTypes.map(sqlString).join(', ')})` : ''}
    AND a.ad_id IS NOT NULL AND a.ad_id != ''
  GROUP BY a.event_date, a.ad_id
  HAVING SUM(a.spend) != 0
) x
GROUP BY x.aid
ORDER BY ad LIMIT ${PAGE} OFFSET ${offset}`);
    for (const r of rows) out.push({ adId: String(r.ad), adName: r.nm ?? '', spend: Number(r.t) || 0 });
    if (rows.length < PAGE) break;
  }
  return out;
}
