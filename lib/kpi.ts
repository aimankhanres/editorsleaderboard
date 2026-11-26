/**
 * KPI rules, edited on the Settings screen and stored in kv `kpi_rules` (defaults below until someone saves).
 * A rule says: for this team (or every team) and this level (or every level), between these dates, a person should
 * finish `perWeek` edits over `workdays` days a week (5 = Mon–Fri, 6 = Mon–Sat, 7 = every day).
 * For a given person and day, the MOST SPECIFIC matching rule wins:
 *   a level (Lead / Senior / Editor) counts more than a team, a team more than "all";
 *   on a tie, a rule with an end date (a temporary rule, e.g. October) beats an open-ended one, then the later start wins.
 */
import { TEAMS, tierOf, type Team, type Tier } from './teams';

export type KpiRule = {
  id: string;
  team: string; // team id or '*'
  tier: Tier | '*';
  perWeek: number;
  workdays: 5 | 6 | 7;
  from: string; // YYYY-MM-DD
  to: string | null; // inclusive, or null = open-ended
  note?: string;
};

export const DEFAULT_RULES: KpiRule[] = [
  { id: 'base', team: '*', tier: '*', perWeek: 5, workdays: 5, from: '2026-01-01', to: null, note: '1 a day, Mon–Fri' },
  { id: 'resizing', team: 'resizing', tier: '*', perWeek: 14, workdays: 7, from: '2026-01-01', to: null, note: '2 a day, every day' },
  { id: 'leads', team: '*', tier: 'lead', perWeek: 0, workdays: 5, from: '2026-01-01', to: null, note: 'Leads manage the team' },
  { id: 'oct-2026', team: '*', tier: '*', perWeek: 3, workdays: 5, from: '2026-10-01', to: '2026-10-31', note: 'October: 3 a week (Resizing keeps its own rule)' },
];

export const dowOf = (ymd: string) => (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon=0

const score = (r: KpiRule) => (r.tier !== '*' ? 2 : 0) + (r.team !== '*' ? 1 : 0);

/** The rule that applies to a member of `team` with org-chart `role` on `day` (null if none) */
export function ruleFor(rules: KpiRule[], team: Team, role: string, day: string): KpiRule | null {
  const tier = tierOf(role);
  let best: KpiRule | null = null;
  for (const r of rules) {
    if ((r.team !== '*' && r.team !== team.id) || (r.tier !== '*' && r.tier !== tier)) continue;
    if (day < r.from || (r.to && day > r.to)) continue;
    if (!best) { best = r; continue; }
    const a = score(r), b = score(best);
    if (a !== b) { if (a > b) best = r; continue; }
    const ta = r.to ? 1 : 0, tb = best.to ? 1 : 0;
    if (ta !== tb) { if (ta > tb) best = r; continue; }
    if (r.from > best.from) best = r;
  }
  return best;
}

/** Edits expected on one day (0 on a day off) */
export function perDay(rules: KpiRule[], team: Team, role: string, day: string): number {
  const r = ruleFor(rules, team, role, day);
  if (!r || !r.perWeek) return 0;
  return dowOf(day) < r.workdays ? r.perWeek / r.workdays : 0;
}

/** Workdays a week for a team's editors on a day (for shading days off in the grid) */
export function workdaysOf(rules: KpiRule[], team: Team, day: string): number {
  return ruleFor(rules, team, 'Editor', day)?.workdays ?? 5;
}

export function validRules(x: unknown): KpiRule[] | null {
  if (!Array.isArray(x) || x.length > 200) return null;
  const teamIds = new Set(TEAMS.map(t => t.id));
  const out: KpiRule[] = [];
  for (const r of x as Partial<KpiRule>[]) {
    const date = (d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (!r || typeof r.id !== 'string' || !(r.team === '*' || teamIds.has(String(r.team)))) return null;
    if (!['*', 'lead', 'senior', 'editor'].includes(String(r.tier))) return null;
    if (typeof r.perWeek !== 'number' || !(r.perWeek >= 0 && r.perWeek <= 100)) return null;
    if (![5, 6, 7].includes(Number(r.workdays)) || !date(r.from) || !(r.to == null || (date(r.to) && r.to >= r.from!))) return null;
    out.push({ id: r.id.slice(0, 40), team: String(r.team), tier: r.tier as KpiRule['tier'], perWeek: r.perWeek,
      workdays: Number(r.workdays) as 5 | 6 | 7, from: r.from!, to: r.to ?? null, note: typeof r.note === 'string' ? r.note.slice(0, 120) : undefined });
  }
  return out;
}

/** Plain-words summary of the rules in effect (for the KPI rules popover on Capacity) */
export function describeRules(rules: KpiRule[]) {
  const teamName = new Map(TEAMS.map(t => [t.id, t.name]));
  const fmt = (r: KpiRule) => `${r.perWeek} a week${r.perWeek ? ` (${Math.round((r.perWeek / r.workdays) * 100) / 100} a day, ${r.workdays === 5 ? 'Mon–Fri' : r.workdays === 6 ? 'Mon–Sat' : 'every day'})` : ''}`;
  return rules.map(r => ({
    who: `${r.tier === '*' ? 'Everyone' : r.tier[0].toUpperCase() + r.tier.slice(1) + 's'} · ${r.team === '*' ? 'all teams' : teamName.get(r.team) ?? r.team}`,
    kpi: fmt(r), when: r.to ? `${r.from} to ${r.to}` : `from ${r.from}`,
  }));
}
