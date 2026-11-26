/**
 * Strategist attribution (Aiman, Nov 26 2026): the ad name's pod wins.
 *  1. Pod in the ad name ("…_Pod 111_…") -> that pod's strategist(s) (lib/pods.ts) get the ad's full spend; a shared pod
 *     is ONE joint row ("Liran Ravid / Farwa Javeed") with the full spend. Works on every ad, with or without a brief ID, whether or not an editor was found.
 *  2. No pod (or an unknown pod / the Auto Bot pod) -> the brief's ClickUp "Strategist" field: for agency (6-digit)
 *     briefs the original agency task's Strategist first, else the Resilia task's. Two strategists = one joint row.
 *  3. Neither -> "No strategist", never dropped.
 * ClickUp Strategist users are matched to pod people by email (workspace members, kv `cu_users`), so one person is
 * one row whichever way their spend arrived. Only email hashes are stored (lib/pods emailHash).
 */
import { cfg } from './config';
import { addDays, nextMonth } from './dates';
import { viewChannels, type ChannelView } from './channels';
import { PEOPLE, PERSON_BY_EMAIL, PODS, podOf, type Strategist } from './pods';
import type { EditorRef, WinnerAd } from './types';

export type StrategistRow = {
  key: string; name: string; group: string; active: boolean; pods: number[];
  spend: number; share: number; ads: number; briefs: number; winners: WinnerAd[];
  /** how the spend arrived: from the ad name's pod vs the ClickUp Strategist field */
  podSpend: number; clickupSpend: number;
  /** Editors whose work this strategist's ads were credited to, biggest first */
  editors: { name: string; spend: number }[];
  products: string[];
  topBriefs: { briefId: string; taskName: string | null; taskUrl: string | null; spend: number }[];
};
export type StrategistPayload = {
  month: string; range: { from: string; to: string } | null; channel: ChannelView; months: string[];
  dataFrom: string | null; dataTo: string | null;
  total: number; withStrategist: number; byPod: number; byClickUp: number;
  /** kept for the UI: spend credited to editors in the same period */
  attributed: number;
  noStrategist: { spend: number; ads: number; briefs: number };
  /** pod numbers seen in ad names that aren't in the pod list */
  unknownPods: { pod: number; spend: number; ads: number }[];
  strategists: StrategistRow[]; winnerSpend: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const PRODUCT: Record<string, string> = { OO: 'Oregano', AOG: 'Garlic', CIN: 'Cinnamon' };

type Who = { key: string; name: string; group: string; active: boolean };
const fromPod = (s: Strategist): Who => ({ key: s.key, name: s.name, group: s.group, active: s.active });
/** Two or more people credited together (a shared pod, or two Strategists on a task): ONE joint row with the full amount */
const joint = (ws: Who[]): Who => {
  const u = [...new Map(ws.map(w => [w.key, w])).values()].sort((a, b) => a.name.localeCompare(b.name));
  return u.length === 1 ? u[0] : { key: u.map(w => w.key).join('+'), name: u.map(w => w.name).join(' / '), group: u[0].group, active: u.every(w => w.active) };
};

export async function buildStrategists(month: string, view: ChannelView = 'meta', range: { from: string; to: string } | null = null,
  opts: { agency?: boolean } = {}): Promise<StrategistPayload> {
  const store = await import('./store');
  const [ads, months, span, usersKv] = await Promise.all([
    range ? store.loadAds(range.from, addDays(range.to, 1), viewChannels(view)) : store.loadAds(`${month}-01`, `${nextMonth(month)}-01`, viewChannels(view)),
    store.monthsAvailable(),
    store.dataSpan(),
    store.kvGet<{ users: { id: number; name: string; hash: string | null }[] }>('cu_users'),
  ]);
  const briefs = await store.loadBriefMap([...new Set(ads.flatMap(a => a.briefIds))], { agency: opts.agency ?? cfg.agencyCredit });
  const emailOf = new Map((usersKv?.users ?? []).map(u => [`u:${u.id}`, u.hash]));
  // A ClickUp Strategist user -> the pod person with that email, else their own row
  const norm = (n: string) => n.normalize('NFD').replace(/[^a-zA-Z ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  const byName = new Map(Object.values(PEOPLE).map(p => [norm(p.name), p]));
  const fromClickUp = (e: EditorRef): Who => {
    // by email hash, else by the same full name (some people use a different email in ClickUp)
    const p = PERSON_BY_EMAIL.get(emailOf.get(e.key) ?? '') ?? byName.get(norm(e.name));
    return p ? fromPod(p) : { key: e.key, name: e.name, group: 'ClickUp only', active: true };
  };
  const podsOf = new Map<string, Set<number>>();
  for (const [n, ps] of Object.entries(PODS)) { const k = joint(ps.map(fromPod)).key; podsOf.set(k, (podsOf.get(k) ?? new Set()).add(Number(n))); }

  type Acc = Who & { spend: number; podSpend: number; clickupSpend: number; ads: Set<string>;
    briefs: Map<string, { taskName: string | null; taskUrl: string | null; spend: number }>;
    winners: Map<string, WinnerAd>; editors: Map<string, number>; products: Set<string> };
  const acc = new Map<string, Acc>();
  let total = 0, byPod = 0, byClickUp = 0, attributed = 0;
  const none = { spend: 0, ads: 0, briefs: new Set<string>() };
  const unknown = new Map<number, { spend: number; ads: number }>();

  const credit = (who: Who, amount: number, ad: { adId: string; adName: string; spend: number }, briefId: string | null, via: 'pod' | 'clickup') => {
    let a = acc.get(who.key);
    if (!a) { a = { ...who, spend: 0, podSpend: 0, clickupSpend: 0, ads: new Set(), briefs: new Map(), winners: new Map(), editors: new Map(), products: new Set() }; acc.set(who.key, a); }
    a.spend += amount;
    if (via === 'pod') a.podSpend += amount; else a.clickupSpend += amount;
    a.ads.add(ad.adId);
    const info = briefId ? briefs.get(briefId) : undefined;
    const key = briefId ?? '(no brief ID)';
    const b = a.briefs.get(key) ?? { taskName: info?.agency?.taskName ?? info?.taskName ?? (briefId ? null : ad.adName), taskUrl: info?.agency?.taskUrl ?? info?.taskUrl ?? null, spend: 0 };
    b.spend += amount;
    a.briefs.set(key, b);
    if (ad.spend >= cfg.winnerSpend && !a.winners.has(ad.adId)) a.winners.set(ad.adId, { adId: ad.adId, adName: ad.adName, spend: round2(ad.spend), briefId: briefId ?? '', taskUrl: b.taskUrl });
    const eds = [...(info?.status === 'ok' ? info.editors : []), ...(info?.agency?.editors ?? [])];
    for (const e of eds) a.editors.set(e.name, (a.editors.get(e.name) ?? 0) + amount / eds.length);
    const p = PRODUCT[(briefId ?? ad.adName).match(/^\s*(OO|AOG|CIN)/i)?.[1]?.toUpperCase() ?? ''];
    if (p) a.products.add(p);
  };

  for (const ad of ads) {
    total += ad.spend;
    const share = ad.briefIds.length ? ad.spend / ad.briefIds.length : ad.spend;
    for (const id of ad.briefIds) {
      const info = briefs.get(id);
      if (info && ((info.status === 'ok' && info.editors.length) || info.agency?.editors.length)) attributed += share;
    }
    // 1. The ad name's pod
    const pod = podOf(ad.adName);
    const people = pod != null ? PODS[pod] ?? [] : [];
    if (pod != null && !PODS[pod] && pod !== 999) {
      const u = unknown.get(pod) ?? { spend: 0, ads: 0 };
      unknown.set(pod, { spend: u.spend + ad.spend, ads: u.ads + 1 });
    }
    if (people.length) {
      byPod += ad.spend;
      const who = joint(people.map(fromPod)); // a shared pod is one joint row with the full spend
      const briefIds = ad.briefIds.length ? ad.briefIds : [null];
      for (const id of briefIds) credit(who, ad.spend / briefIds.length, ad, id, 'pod');
      continue;
    }
    // 2. The ClickUp Strategist field, per brief
    let credited = false;
    for (const id of ad.briefIds) {
      const info = briefs.get(id);
      const strats = (info?.agency?.strategists?.length ? info.agency.strategists : info?.strategists ?? []).map(fromClickUp);
      const uniq = [...new Map(strats.map(s => [s.key, s])).values()];
      if (!uniq.length) { none.spend += share; none.briefs.add(id); continue; }
      byClickUp += share; credited = true;
      credit(joint(uniq), share, ad, id, 'clickup'); // two Strategists on a task: one joint row, like a shared pod
    }
    // 3. Nothing
    if (!ad.briefIds.length) none.spend += ad.spend;
    if (!credited) none.ads++;
  }

  const withStrategist = byPod + byClickUp;
  const strategists = [...acc.values()].map(a => ({
    key: a.key, name: a.name, group: a.group, active: a.active, pods: [...(podsOf.get(a.key) ?? [])].sort((x, y) => x - y),
    spend: round2(a.spend), share: withStrategist ? a.spend / withStrategist : 0, ads: a.ads.size,
    briefs: [...a.briefs.keys()].filter(k => k !== '(no brief ID)').length,
    podSpend: round2(a.podSpend), clickupSpend: round2(a.clickupSpend),
    winners: [...a.winners.values()].sort((x, y) => y.spend - x.spend),
    editors: [...a.editors].map(([name, spend]) => ({ name, spend: round2(spend) })).sort((x, y) => y.spend - x.spend).slice(0, 5),
    products: [...a.products].sort(),
    topBriefs: [...a.briefs].map(([briefId, b]) => ({ briefId, ...b, spend: round2(b.spend) })).sort((x, y) => y.spend - x.spend).slice(0, 25),
  })).sort((x, y) => y.spend - x.spend || x.name.localeCompare(y.name));

  return {
    month, range, channel: view, months: months.includes(month) ? months : [month, ...months].sort().reverse(),
    dataFrom: span.from, dataTo: span.to,
    total: round2(total), withStrategist: round2(withStrategist), byPod: round2(byPod), byClickUp: round2(byClickUp),
    attributed: round2(attributed),
    noStrategist: { spend: round2(none.spend), ads: none.ads, briefs: none.briefs.size },
    unknownPods: [...unknown].map(([pod, u]) => ({ pod, spend: round2(u.spend), ads: u.ads })).sort((a, b) => b.spend - a.spend),
    strategists, winnerSpend: cfg.winnerSpend,
  };
}
