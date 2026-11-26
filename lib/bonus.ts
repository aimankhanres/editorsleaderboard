/**
 * Editor Incentive Program (Oct 2026): monthly bonus as a % of base pay, from each level's scorecard.
 * Only percentages: no salaries are stored. Sources: the ClickUp task mirror (Edit Complete Date, Total Revisions,
 * time in each status) and hand-scored lines entered on the Bonus screen (kv `bonus_manual`).
 *
 * Scoring: every line has a 100% target. "Close can count": >= 90% of target pays 75% of the line, >= 80% pays 50%.
 * Output for Base Editors pays by its own steps (4+/wk 10%, 7+ 12.5%, 10+ 15%).
 */
import { q } from './db';
import { addDays, nextMonth, todayIn } from './dates';
import { TEAMS, boardOf, memberKey, tierOf, type Tier } from './teams';
import { ensureTaskTables, kvGet } from './store';

const TZ = process.env.CAPACITY_TIMEZONE ?? 'Asia/Karachi';
export const BONUS_RULES = {
  close: [{ atLeast: 1, pays: 1 }, { atLeast: 0.9, pays: 0.75 }, { atLeast: 0.8, pays: 0.5 }],
  revisionHours: 24, // revisions completed within the agreed 24-hour window
  reviewHours: 12, // Seniors review the queue at least twice a day
  backlogHours: 24, // work doesn't wait more than a day for Senior / Lead review
  maxRevisions: 2, // quality: edits stay within 2 revision rounds
  revisionStatus: /revision/i,
  reviewStatus: /review/i,
};
const closePays = (ratio: number) => BONUS_RULES.close.find(c => ratio >= c.atLeast - 1e-9)?.pays ?? 0;

export type Line = {
  id: string; label: string; weight: number; earned: number;
  /** the measured value in words ("6.3 edits / week", "92% on time") and the 100% target */
  value: string; target: string; manual?: boolean; basis?: string;
};
export type Scorecard = {
  key: string; name: string; tier: Tier; role: string; teams: string[]; group: string;
  max: number; total: number; lines: Line[];
  edits: number; perWeek: number;
  tracked: { spend: number | null; winners: number | null };
};
export type BonusPayload = {
  month: string; current: boolean; weeks: number; people: Scorecard[];
  rules: { revisionHours: number; reviewHours: number; backlogHours: number; maxRevisions: number; close: string };
  coverage: { tasks: number; withRevisions: number; withStatusTime: number };
};

type TaskRow = {
  task_id: string; workspace: string; list_id: string | null; product: string | null; name: string;
  editor_ids: string[]; senior_ids: string[]; revisions: number | null; status_time: Record<string, number> | null;
};
type Metric = { revisions: number | null; revPerRound: number | null; reviewPerRound: number | null };

function metric(t: TaskRow): Metric {
  const st = t.status_time ?? {};
  const revStatuses = Object.entries(st).filter(([s, m]) => BONUS_RULES.revisionStatus.test(s) && m > 0);
  const revisions = t.revisions ?? (t.status_time ? revStatuses.length : null);
  const revMin = revStatuses.reduce((a, [, m]) => a + m, 0);
  const reviewMin = Object.entries(st).filter(([s]) => BONUS_RULES.reviewStatus.test(s)).reduce((a, [, m]) => a + m, 0);
  return {
    revisions,
    revPerRound: t.status_time && revMin > 0 ? revMin / Math.max(1, revisions ?? 1) : null,
    reviewPerRound: t.status_time && reviewMin > 0 ? reviewMin / ((revisions ?? 0) + 1) : null,
  };
}
/** share of tasks meeting a test (null when none can be judged) */
const rate = (xs: Metric[], ok: (m: Metric) => boolean | null) => {
  const judged = xs.map(ok).filter((v): v is boolean => v !== null);
  return judged.length ? { r: judged.filter(Boolean).length / judged.length, n: judged.length } : null;
};
const pct = (r: number) => `${Math.round(r * 100)}%`;
const qualityOk = (m: Metric) => (m.revisions == null ? null : m.revisions <= BONUS_RULES.maxRevisions);
const revOnTime = (m: Metric) => (m.revPerRound == null ? null : m.revPerRound <= BONUS_RULES.revisionHours * 60);
const reviewOnTime = (h: number) => (m: Metric) => (m.reviewPerRound == null ? null : m.reviewPerRound <= h * 60);

/** A rate line: 100% target, close-can-count; no tasks to judge = not measurable yet (earns nothing) */
function rateLine(id: string, label: string, weight: number, r: { r: number; n: number } | null, what: string): Line {
  if (!r) return { id, label, weight, earned: 0, value: `no ${what} this month`, target: '100%', basis: '0 tasks' };
  return { id, label, weight, earned: weight * closePays(r.r), value: pct(r.r), target: '100%', basis: `${r.n} ${what}` };
}

export async function buildBonus(monthParam?: string | null): Promise<BonusPayload> {
  await ensureTaskTables();
  const today = todayIn(TZ);
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : today.slice(0, 7);
  const from = `${month}-01`, toExcl = `${nextMonth(month)}-01`;
  const current = today >= from && today < toExcl;
  const lastDay = current ? today : addDays(toExcl, -1);
  const days = Math.round((Date.parse(`${lastDay}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5) + 1;
  const weeks = days / 7;

  const tasks = await q<TaskRow>(
    `SELECT task_id, workspace, list_id, product, name, ARRAY(SELECT x::text FROM unnest(editor_ids) x) editor_ids,
            ARRAY(SELECT x::text FROM unnest(senior_ids) x) senior_ids, revisions, status_time
       FROM cu_tasks
      WHERE jsonb_array_length(editors) > 0
        AND COALESCE(edit_done, delivered) >= ($1::date)::timestamp AT TIME ZONE $3
        AND COALESCE(edit_done, delivered) <  ($2::date)::timestamp AT TIME ZONE $3`, [from, toExcl, TZ]);
  const m = new Map(tasks.map(t => [t.task_id, metric(t)]));
  const board = (t: TaskRow) => boardOf({ listId: t.list_id, workspace: t.workspace, product: t.product, name: t.name });
  const manual = (await kvGet<Record<string, Record<string, Record<string, number>>>>('bonus_manual'))?.[month] ?? {};

  // One scorecard per person (people on two teams: one card, all their teams)
  const people = new Map<string, { id: number; name: string; role: string; teams: string[]; teamIds: string[]; group: string }>();
  for (const t of TEAMS) for (const mm of t.members) {
    if (!mm.id) continue;
    const k = memberKey(mm), p = people.get(k);
    if (p) { p.teams.push(t.name); p.teamIds.push(t.id); continue; }
    people.set(k, { id: mm.id, name: mm.name, role: mm.role, teams: [t.name], teamIds: [t.id], group: t.group });
  }

  const own = (id: number) => tasks.filter(t => t.editor_ids.includes(String(id)));
  const ownEditing = (id: number, perWeekTarget: number) => {
    const mine = own(id), mx = mine.map(t => m.get(t.task_id)!);
    const perWeek = mine.length / weeks;
    const out = perWeek >= perWeekTarget ? 1 : closePays(perWeek / perWeekTarget);
    const turn = rate(mx, revOnTime), qual = rate(mx, qualityOk);
    const frac = mine.length ? (out * 15 + (turn ? closePays(turn.r) : 1) * 5 + (qual ? closePays(qual.r) : 0) * 10) / 30 : 0;
    return { frac, perWeek, n: mine.length, turn, qual };
  };

  const cards: Scorecard[] = [];
  for (const [key, p] of people) {
    const tier = tierOf(p.role);
    const mine = own(p.id), mx = mine.map(t => m.get(t.task_id)!);
    const perWeek = mine.length / weeks;
    const hand = (line: string) => manual[key]?.[line];
    const manualLine = (id: string, label: string): Line => {
      const v = hand(id);
      return { id, label, weight: 10, earned: v == null ? 0 : 10 * Math.max(0, Math.min(100, v)) / 100, value: v == null ? 'not scored yet' : `${v}%`, target: '100%', manual: true };
    };
    let lines: Line[] = [];
    let max = 30;
    if (tier === 'editor') {
      const outEarned = perWeek >= 10 ? 15 : perWeek >= 7 ? 12.5 : perWeek >= 4 ? 10 : 10 * closePays(perWeek / 4);
      const turn = rate(mx, revOnTime), qual = rate(mx, qualityOk);
      lines = [
        { id: 'output', label: 'Output', weight: 15, earned: outEarned, value: `${perWeek.toFixed(1)} edits / week`, target: '4+ = 10% · 7+ = 12.5% · 10+ = 15%', basis: `${mine.length} edits` },
        turn ? { ...rateLine('turnaround', 'Revision turnaround', 5, turn, 'revised edits'), value: `${pct(turn.r)} within ${BONUS_RULES.revisionHours}h` }
          : { id: 'turnaround', label: 'Revision turnaround', weight: 5, earned: mine.length ? 5 : 0, value: mine.length ? 'no revisions needed' : 'no edits', target: '100% within 24h' },
        { ...rateLine('quality', 'Quality', 10, qual, 'edits with a revision count'), value: qual ? `${pct(qual.r)} within ${BONUS_RULES.maxRevisions} rounds` : 'no revision counts yet' },
      ];
    } else if (tier === 'senior') {
      max = 40;
      const o = ownEditing(p.id, 2);
      const reviewed = tasks.filter(t => t.senior_ids.includes(String(p.id)) && !t.editor_ids.includes(String(p.id))).map(t => m.get(t.task_id)!);
      const podQ = rate(reviewed, qualityOk), revT = rate(reviewed, reviewOnTime(BONUS_RULES.reviewHours));
      lines = [
        { id: 'own', label: 'Own editing', weight: 10, earned: 10 * o.frac, value: `${o.perWeek.toFixed(1)} edits / week${o.qual ? ` · ${pct(o.qual.r)} quality` : ''}`, target: '2+ / week, on time, within 2 rounds', basis: `${o.n} edits` },
        { ...rateLine('pod_quality', 'Pod quality', 10, podQ, 'reviewed edits'), value: podQ ? `${pct(podQ.r)} within ${BONUS_RULES.maxRevisions} rounds` : 'no reviewed edits' },
        { ...rateLine('review_turnaround', 'Review turnaround', 10, revT, 'reviewed edits'), value: revT ? `${pct(revT.r)} reviewed within ${BONUS_RULES.reviewHours}h` : 'no review times yet' },
        manualLine('blockers', 'Fixing editing blockers'),
      ];
    } else {
      max = 50;
      const o = ownEditing(p.id, 1);
      const teamTasks = tasks.filter(t => { const b = board(t); return b != null && p.teamIds.includes(b); }).map(t => m.get(t.task_id)!);
      const skuQ = rate(teamTasks, qualityOk), backlog = rate(teamTasks, reviewOnTime(BONUS_RULES.backlogHours));
      lines = [
        { id: 'own', label: 'Own editing', weight: 10, earned: 10 * o.frac, value: `${o.perWeek.toFixed(1)} edits / week`, target: '1+ / week, on time, within 2 rounds', basis: `${o.n} edits` },
        { ...rateLine('sku_quality', 'SKU editing quality', 10, skuQ, 'team edits'), value: skuQ ? `${pct(skuQ.r)} within ${BONUS_RULES.maxRevisions} rounds` : 'no team edits' },
        { id: 'senior_perf', label: 'Senior Editor performance', weight: 10, earned: 0, value: '', target: 'Seniors at 100% of their scorecard' },
        { ...rateLine('backlog', 'Review and backlog health', 10, backlog, 'team edits'), value: backlog ? `${pct(backlog.r)} waited under ${BONUS_RULES.backlogHours}h for review` : 'no review times yet' },
        manualLine('recurring_blockers', 'Recurring blockers'),
      ];
    }
    const total = lines.reduce((a, l) => a + l.earned, 0);
    cards.push({ key, name: p.name, tier, role: p.role, teams: p.teams, group: p.group, max, total, lines, edits: mine.length, perWeek,
      tracked: { spend: null, winners: null } });
  }
  // Leads: "Senior Editor performance" = how close their teams' Seniors are to a full scorecard
  for (const c of cards.filter(c => c.tier === 'lead')) {
    const seniors = cards.filter(s => s.tier === 'senior' && s.teams.some(t => c.teams.includes(t)));
    const line = c.lines.find(l => l.id === 'senior_perf')!;
    if (seniors.length) {
      const avg = seniors.reduce((a, s) => a + s.total / s.max, 0) / seniors.length;
      line.earned = 10 * closePays(avg);
      line.value = `${seniors.length} Senior${seniors.length === 1 ? '' : 's'} at ${pct(avg)} of their scorecard`;
    } else line.value = 'no Seniors on these teams';
    c.total = c.lines.reduce((a, l) => a + l.earned, 0);
  }
  cards.sort((a, b) => b.total / b.max - a.total / a.max || a.name.localeCompare(b.name));
  return {
    month, current, weeks: Math.round(weeks * 10) / 10, people: cards,
    rules: { revisionHours: BONUS_RULES.revisionHours, reviewHours: BONUS_RULES.reviewHours, backlogHours: BONUS_RULES.backlogHours,
      maxRevisions: BONUS_RULES.maxRevisions, close: '100% of target pays the full line · 90% pays 75% · 80% pays 50%' },
    coverage: { tasks: tasks.length, withRevisions: tasks.filter(t => t.revisions != null).length, withStatusTime: tasks.filter(t => t.status_time != null).length },
  };
}
