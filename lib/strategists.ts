/**
 * Strategist attribution: the same rule as editors, one step later. Every ad whose brief is credited to an editor
 * (ClickUp task found, Editor set) is also credited to the task's "Strategist" field (read from the task mirror).
 * Two strategists on a task split it evenly (SPLIT_MODE=split) like two editors. Credited briefs with no strategist
 * are reported as "No strategist" rather than dropped.
 */
import { cfg } from './config';
import { addDays, nextMonth } from './dates';
import { viewChannels, type ChannelView } from './channels';
import type { WinnerAd } from './types';

export type StrategistRow = {
  key: string; name: string; spend: number; share: number; ads: number; briefs: number; winners: WinnerAd[];
  /** Editors whose work this strategist's briefs were credited to, biggest first */
  editors: { name: string; spend: number }[];
  products: string[];
  topBriefs: { briefId: string; taskName: string | null; taskUrl: string | null; spend: number }[];
};
export type StrategistPayload = {
  month: string; range: { from: string; to: string } | null; channel: ChannelView; months: string[];
  dataFrom: string | null; dataTo: string | null;
  total: number; attributed: number; withStrategist: number; noStrategist: { spend: number; briefs: number };
  strategists: StrategistRow[]; winnerSpend: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const PRODUCT: Record<string, string> = { OO: 'Oregano', AOG: 'Garlic', CIN: 'Cinnamon' };

export async function buildStrategists(month: string, view: ChannelView = 'meta', range: { from: string; to: string } | null = null,
  opts: { agency?: boolean } = {}): Promise<StrategistPayload> {
  const store = await import('./store');
  const [ads, months, span] = await Promise.all([
    range ? store.loadAds(range.from, addDays(range.to, 1), viewChannels(view)) : store.loadAds(`${month}-01`, `${nextMonth(month)}-01`, viewChannels(view)),
    store.monthsAvailable(),
    store.dataSpan(),
  ]);
  const briefs = await store.loadBriefMap([...new Set(ads.flatMap(a => a.briefIds))], { agency: opts.agency ?? cfg.agencyCredit });
  type Acc = { key: string; name: string; spend: number; ads: Set<string>; briefs: Map<string, { taskName: string | null; taskUrl: string | null; spend: number }>;
    winners: Map<string, WinnerAd>; editors: Map<string, number>; products: Set<string> };
  const acc = new Map<string, Acc>();
  let total = 0, attributed = 0, withStrategist = 0;
  const none = { spend: 0, briefs: new Set<string>() };

  for (const ad of ads) {
    total += ad.spend;
    if (!ad.briefIds.length) continue;
    const share = ad.spend / ad.briefIds.length;
    for (const id of ad.briefIds) {
      const info = briefs.get(id);
      const resizeOk = !!info && info.status === 'ok' && info.editors.length > 0;
      const agencyOk = !!info?.agency?.editors.length;
      if (!info || (!resizeOk && !agencyOk)) continue; // not credited to an editor
      attributed += share;
      // Agency briefs: the strategist on the original agency task (the resize task rarely has one)
      const strats = info.strategists?.length ? info.strategists : info.agency?.strategists ?? [];
      const eds = [...(resizeOk ? info.editors : []), ...(info.agency?.editors ?? [])];
      if (!strats.length) { none.spend += share; none.briefs.add(id); continue; }
      withStrategist += share;
      const each = cfg.splitMode === 'joint' ? share : share / strats.length;
      for (const st of strats) {
        let a = acc.get(st.key);
        if (!a) { a = { key: st.key, name: st.name, spend: 0, ads: new Set(), briefs: new Map(), winners: new Map(), editors: new Map(), products: new Set() }; acc.set(st.key, a); }
        a.spend += each;
        a.ads.add(ad.adId);
        const b = a.briefs.get(id) ?? { taskName: info.agency?.taskName ?? info.taskName, taskUrl: info.agency?.taskUrl ?? info.taskUrl, spend: 0 };
        b.spend += each;
        a.briefs.set(id, b);
        if (ad.spend >= cfg.winnerSpend && !a.winners.has(ad.adId)) a.winners.set(ad.adId, { adId: ad.adId, adName: ad.adName, spend: round2(ad.spend), briefId: id, taskUrl: info.agency?.taskUrl ?? info.taskUrl });
        for (const e of eds) a.editors.set(e.name, (a.editors.get(e.name) ?? 0) + each / eds.length);
        const p = PRODUCT[id.match(/^[A-Z]+/)?.[0] ?? ''];
        if (p) a.products.add(p);
      }
    }
  }
  const credited = withStrategist || 1;
  const strategists = [...acc.values()].map(a => ({
    key: a.key, name: a.name, spend: round2(a.spend), share: a.spend / credited, ads: a.ads.size, briefs: a.briefs.size,
    winners: [...a.winners.values()].sort((x, y) => y.spend - x.spend),
    editors: [...a.editors].map(([name, spend]) => ({ name, spend: round2(spend) })).sort((x, y) => y.spend - x.spend).slice(0, 5),
    products: [...a.products].sort(),
    topBriefs: [...a.briefs].map(([briefId, b]) => ({ briefId, ...b, spend: round2(b.spend) })).sort((x, y) => y.spend - x.spend).slice(0, 25),
  })).sort((x, y) => y.spend - x.spend || x.name.localeCompare(y.name));

  return {
    month, range, channel: view, months: months.includes(month) ? months : [month, ...months].sort().reverse(),
    dataFrom: span.from, dataTo: span.to,
    total: round2(total), attributed: round2(attributed), withStrategist: round2(withStrategist),
    noStrategist: { spend: round2(none.spend), briefs: none.briefs.size }, strategists, winnerSpend: cfg.winnerSpend,
  };
}
