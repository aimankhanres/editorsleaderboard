/** Fake but realistic data so the UI runs with no DATABASE_URL. Names are invented. */
import { cfg } from './config';
import { extractBriefIds } from './briefs';
import { monthOf, prevMonth, todayIn } from './dates';
import { allocate, rank } from './leaderboard';
import type { AdAgg, BriefInfo, LeaderboardPayload, RosterEntry } from './types';

const EDITORS = [
  'Nora Quill', 'Theo Marsh', 'Ivy Calder', 'Felix Rowan', 'Maya Torres', 'Owen Pike', 'Lena Brooks',
  'Ravi Stone', 'Zara Finch', 'Caleb Wren', 'Juno Hart', 'Milo Grant',
];
const LEFT = new Set(['Owen Pike']);

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export function demoLeaderboard(month: string): LeaderboardPayload {
  const rand = rng(Number(month.replace('-', '')));
  const roster = new Map<string, RosterEntry>(
    EDITORS.map((n, i) => [`u:${1000 + i}`, { name: n, avatar: null, active: !LEFT.has(n) }]),
  );
  const keys = [...roster.keys()];
  const briefs = new Map<string, BriefInfo>();
  const ads: AdAgg[] = [];

  for (let b = 0; b < 70; b++) {
    const briefId = `OO-${18000 + Math.floor(rand() * 7000)}`;
    const r = rand();
    const ed = r < 0.85 ? [keys[Math.floor(Math.pow(rand(), 1.6) * keys.length)]]
      : r < 0.92 ? [keys[Math.floor(rand() * keys.length)], keys[Math.floor(rand() * keys.length)]] : [];
    const editors = [...new Set(ed)].map(k => ({ key: k, name: roster.get(k)!.name, avatar: null }));
    const status = r > 0.97 ? 'not_found' : editors.length ? 'ok' : 'no_editor';
    const taskId = `86d${(1000 + b).toString(36)}`;
    briefs.set(briefId, {
      briefId, editors: status === 'not_found' ? [] : editors, status,
      taskId: status === 'not_found' ? null : taskId,
      taskName: status === 'not_found' ? null : `${briefId} - Hook test ${b + 1}`,
      taskUrl: status === 'not_found' ? null : `https://app.clickup.com/t/${taskId}`,
    });
    const copies = 1 + Math.floor(rand() * 4);
    for (let c = 0; c < copies; c++) {
      // Occasionally name a different editor in the ad name to exercise the mismatch check
      const who = rand() < 0.06 ? roster.get(keys[Math.floor(rand() * keys.length)])!.name.split(' ')[0]
        : editors[0] ? roster.get(editors[0].key)!.name.split(' ')[0] : 'Liran';
      const name = `${c % 2 ? '9x16' : '4x5'}_${who}_H${c + 1}_${briefId}`;
      ads.push({ adId: `${b}-${c}`, adName: name, campaign: 'Demo', spend: Math.round(Math.pow(rand(), 3) * 90000 * 100) / 100, briefIds: extractBriefIds(name) });
    }
  }
  // A couple of ads with no brief ID and one with two briefs
  ads.push({ adId: 'x1', adName: 'Retargeting_Carousel_Testimonials', campaign: 'Demo', spend: 18432.17, briefIds: [] });
  ads.push({ adId: 'x2', adName: 'DPA_Catalog_All', campaign: 'Demo', spend: 6120.5, briefIds: [] });
  const [b1, b2] = [...briefs.keys()];
  const combo = `Mashup_${b1}_${b2}`;
  ads.push({ adId: 'x3', adName: combo, campaign: 'Demo', spend: 24000, briefIds: extractBriefIds(combo) });

  const alloc = allocate(ads, briefs, roster, cfg.splitMode);
  // Fake "yesterday" ranks by nudging spends
  const noisy = new Map(alloc.editors.map(e => [e.key, e.spend * (0.75 + rand() * 0.5)]));
  const prevOrder = [...alloc.editors].sort((a, b) => noisy.get(b.key)! - noisy.get(a.key)!);
  const prev = new Map(prevOrder.map((e, i) => [e.key, i + 1]));
  prev.delete(prevOrder[prevOrder.length - 1]?.key); // one "new" entry

  const current = monthOf(todayIn(cfg.timezone));
  return {
    month,
    months: [current, prevMonth(current), prevMonth(prevMonth(current))],
    total: alloc.total,
    attributed: alloc.attributed,
    editors: rank(alloc.editors, prev),
    review: alloc.review,
    lastSync: { at: new Date(Date.now() - 4 * 60_000).toISOString(), ok: true, error: null },
    splitMode: cfg.splitMode,
    demo: true,
  };
}
