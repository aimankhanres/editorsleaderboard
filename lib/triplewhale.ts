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
  event_date: string;
  ad_id: string | number;
  ad_name: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  channel: string | null;
  spend: number | string | null;
};

const sqlString = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// Group by day + ad only (never by ad set/campaign), so each ad is counted once per day.
const QUERY = (channel: string) => `
SELECT
  toString(event_date) AS event_date,
  toString(ad_id)      AS ad_id,
  any(ad_name)         AS ad_name,
  any(campaign_name)   AS campaign_name,
  any(adset_name)      AS adset_name,
  any(channel)         AS channel,
  SUM(spend)           AS spend
FROM ads_table
WHERE event_date BETWEEN @startDate AND @endDate
  AND channel = ${sqlString(channel)}
  AND ad_id IS NOT NULL AND toString(ad_id) != ''
GROUP BY event_date, ad_id
`;

async function runQuery(startDate: string, endDate: string): Promise<TwRow[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${cfg.tw.base}/orcabase/api/sql`, {
      method: 'POST',
      headers: { 'x-api-key': cfg.tw.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopId: cfg.tw.shopId,
        query: QUERY(cfg.tw.channel),
        period: { startDate, endDate },
      }),
      cache: 'no-store',
    });
    if (res.status === 429 && attempt < 2) {
      const wait = Number(res.headers.get('retry-after') ?? 5);
      await new Promise(r => setTimeout(r, Math.min(wait, 20) * 1000));
      continue;
    }
    const body = await res.json().catch(() => null) as { data?: TwRow[]; message?: string } | null;
    if (!res.ok || !body || !Array.isArray(body.data)) {
      throw new Error(`Triple Whale ${res.status}: ${body?.message ?? 'unexpected response'}`);
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
      const adName = r.ad_name ?? '';
      out.push({
        date: String(r.event_date).slice(0, 10),
        adId: String(r.ad_id),
        adName,
        campaign: r.campaign_name,
        adset: r.adset_name,
        channel: r.channel,
        spend: Number(r.spend ?? 0) || 0,
        briefIds: extractBriefIds(adName),
      });
    }
    month = nextMonth(month);
  }
  return out;
}
