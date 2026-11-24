/**
 * Editing capacity: tasks each editor finished per day/week vs their team KPI (lib/teams.ts).
 * Source: the ClickUp task mirror (cu_tasks, filled by /api/tasks-sync). A task counts as done on its
 * "Edit Complete Date" (falling back to "Asset Delivered Date"), in CAPACITY_TIMEZONE (default Asia/Karachi, which
 * keeps one workday of the PH / PK / EU editors on one calendar day). A task with two editors counts for both.
 */
import { q } from './db';
import { addDays, todayIn } from './dates';
import { TEAMS, memberKey, type TeamGroup, type TeamKpi } from './teams';
import { ensureTaskTables, kvGet } from './store';

export const CAPACITY_TZ = process.env.CAPACITY_TIMEZONE ?? 'Asia/Karachi';
const HISTORY_WEEKS = 8;
const OPEN_MAX_AGE_DAYS = 45; // assigned within this many days and not finished = "open"

export type DoneTask = { name: string; url: string; day: string };
export type Pace = 'met' | 'on' | 'behind' | 'none';
export type CapacityMember = {
  key: string; name: string; role: string;
  /** counted here: in Resilia's ClickUp and on a team whose edits happen there */
  inClickUp: boolean;
  days: number[]; done: number; target: number; expected: number; remaining: number; open: number; pace: Pace;
  tasks: DoneTask[];
};
export type CapacityTeam = {
  id: string; name: string; group: TeamGroup; kpi: TeamKpi; workDays: number;
  /** false: this team edits in another ClickUp workspace (Agency), so nothing is measured */
  measured: boolean;
  members: CapacityMember[]; done: number; target: number; expected: number; remaining: number; open: number;
  /** editors in Resilia's ClickUp with nothing in their queue right now */
  idle: number;
  /** one week of this team's capacity, and how far the open queue is above it (0 = no backlog) */
  weekCapacity: number; backlog: number;
  tracked: number; behind: number; history: { week: string; done: number; target: number }[];
};
export type CapacityPayload = {
  /** week: Monday–Sunday; range: custom from–to (week/weekEnd are then the range's first and last day) */
  mode: 'week' | 'range';
  week: string; weekEnd: string; days: string[]; today: string; timezone: string; current: boolean;
  teams: CapacityTeam[];
  company: { editors: number; done: number; target: number; expected: number; remaining: number; open: number; behind: number };
  maxDays: number;
  mirror: { tasks: number; lastSync: string | null; caughtUp: boolean };
};

/** Monday of the week containing `ymd` */
export function mondayOf(ymd: string): string {
  const dow = (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon=0
  return addDays(ymd, -dow);
}

export const MAX_RANGE_DAYS = 92;
const dayCount = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5) + 1;
const dowOf = (ymd: string) => (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon=0

/** opts.week: any day of a week (Mon–Sun). opts.from/to: a custom range (at most MAX_RANGE_DAYS). Neither: this week. */
export async function buildCapacity(opts: { week?: string | null; from?: string | null; to?: string | null } = {}): Promise<CapacityPayload> {
  await ensureTaskTables();
  const today = todayIn(CAPACITY_TZ);
  let mode: 'week' | 'range' = 'week';
  let week: string, weekEnd: string;
  if (opts.from && opts.to) {
    mode = 'range';
    [week, weekEnd] = opts.from <= opts.to ? [opts.from, opts.to] : [opts.to, opts.from];
    if (dayCount(week, weekEnd) > MAX_RANGE_DAYS) week = addDays(weekEnd, -(MAX_RANGE_DAYS - 1));
  } else {
    week = mondayOf(opts.week ?? today);
    weekEnd = addDays(week, 6);
  }
  const days = Array.from({ length: dayCount(week, weekEnd) }, (_, i) => addDays(week, i));
  const current = week <= today && today <= weekEnd;
  const histFrom = addDays(mondayOf(weekEnd), -7 * (HISTORY_WEEKS - 1));
  const qFrom = week < histFrom ? week : histFrom;
  const ids = [...new Set(TEAMS.flatMap(t => t.members).map(m => m.id).filter((x): x is number => x != null))];

  // Finished tasks per editor, from the start of the history window to the end of this week
  const doneRows = await q<{ uid: string; day: string; name: string; url: string | null; task_id: string }>(
    `SELECT u::text AS uid, to_char((COALESCE(edit_done, delivered) AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day,
            name, url, task_id
       FROM cu_tasks, unnest(editor_ids) AS u
      WHERE u = ANY($2::bigint[])
        AND COALESCE(edit_done, delivered) >= ($3::date - 1)::timestamp AT TIME ZONE 'UTC'
        AND COALESCE(edit_done, delivered) <  ($4::date + 2)::timestamp AT TIME ZONE 'UTC'`,
    [CAPACITY_TZ, ids, qFrom, weekEnd],
  );
  const openRows = await q<{ uid: string; n: string }>(
    `SELECT u::text AS uid, COUNT(*) AS n
       FROM cu_tasks, unnest(editor_ids) AS u
      WHERE u = ANY($1::bigint[]) AND edit_done IS NULL AND delivered IS NULL AND closed_at IS NULL
        AND COALESCE(status_type, '') NOT IN ('closed', 'done')
        AND assigned IS NOT NULL AND assigned > now() - make_interval(days => $2::int)
      GROUP BY 1`,
    [ids, OPEN_MAX_AGE_DAYS],
  );
  const open = new Map(openRows.map(r => [Number(r.uid), Number(r.n)]));
  const byUser = new Map<number, { day: string; name: string; url: string }[]>();
  for (const r of doneRows) {
    if (r.day < qFrom || r.day > weekEnd) continue;
    const list = byUser.get(Number(r.uid)) ?? [];
    list.push({ day: r.day, name: r.name, url: r.url ?? `https://app.clickup.com/t/${r.task_id}` });
    byUser.set(Number(r.uid), list);
  }

  // Workdays: perWeek / perDay of them from Monday (14/2 = 7 days, 5/1 = Mon–Fri). Capacity = perDay per workday in the
  // range; expected = perDay per workday up to today.
  const teams: CapacityTeam[] = TEAMS.map(team => {
    const workDays = Math.min(7, Math.round(team.kpi.perWeek / team.kpi.perDay));
    const work = days.filter(d => dowOf(d) < workDays);
    const fullTarget = team.kpi.perDay * work.length;
    const expectedFull = team.kpi.perDay * work.filter(d => d <= today).length;
    const measured = team.capacity !== false;
    const members: CapacityMember[] = team.members.map(mm => {
      const m = measured ? mm : { ...mm, id: null }; // agency teams: list people, measure nothing
      const all = m.id ? byUser.get(m.id) ?? [] : [];
      const mine = all.filter(t => t.day >= week && t.day <= weekEnd).sort((a, b) => b.day.localeCompare(a.day));
      const counts = days.map(d => mine.filter(t => t.day === d).length);
      const done = mine.length;
      const target = m.id ? fullTarget : 0;
      const expected = m.id ? expectedFull : 0;
      const pace: Pace = !m.id ? 'none' : done >= target ? 'met' : done >= expected - team.kpi.perDay ? 'on' : 'behind';
      return {
        key: memberKey(mm), name: m.name, role: m.role, inClickUp: m.id != null, days: counts, done, target, expected,
        remaining: Math.max(0, target - done), open: m.id ? open.get(m.id) ?? 0 : 0, pace, tasks: mine,
      };
    });
    const tracked = members.filter(x => x.inClickUp);
    const history = Array.from({ length: HISTORY_WEEKS }, (_, i) => addDays(histFrom, 7 * i)).map(w => ({
      week: w,
      done: tracked.reduce((s, x) => {
        const id = measured ? team.members.find(m => memberKey(m) === x.key)?.id : null;
        return s + (id ? (byUser.get(id) ?? []).filter(t => t.day >= w && t.day <= addDays(w, 6)).length : 0);
      }, 0),
      target: tracked.length * team.kpi.perWeek,
    }));
    const sum = (f: (x: CapacityMember) => number) => tracked.reduce((s, x) => s + f(x), 0);
    return {
      id: team.id, name: team.name, group: team.group, kpi: team.kpi, workDays, measured, members,
      done: sum(x => x.done), target: sum(x => x.target), expected: sum(x => x.expected), remaining: sum(x => x.remaining),
      open: sum(x => x.open), idle: tracked.filter(x => x.open === 0).length,
      weekCapacity: tracked.length * team.kpi.perWeek,
      backlog: Math.max(0, sum(x => x.open) - tracked.length * team.kpi.perWeek), tracked: tracked.length, behind: tracked.filter(x => x.pace === 'behind').length, history,
    };
  });

  // Company: each person once (people on two teams have one capacity: the larger of their KPIs)
  const people = new Map<string, CapacityMember>();
  for (const t of teams) for (const m of t.members) {
    if (!m.inClickUp) continue;
    const prev = people.get(m.key);
    if (!prev || m.target > prev.target) people.set(m.key, m);
  }
  const ppl = [...people.values()];
  const s = (f: (x: CapacityMember) => number) => ppl.reduce((a, x) => a + f(x), 0);
  const mirrorState = await kvGet<{ since: number; page: number }>('tasks_sync');
  const stats = await q<{ n: string }>(`SELECT COUNT(*) n FROM cu_tasks`);
  return {
    mode, week, weekEnd, days, today, timezone: CAPACITY_TZ, current, teams, maxDays: MAX_RANGE_DAYS,
    company: {
      editors: ppl.length, done: s(x => x.done), target: s(x => x.target), expected: s(x => x.expected),
      remaining: s(x => x.remaining), open: s(x => x.open), behind: ppl.filter(x => x.pace === 'behind').length,
    },
    mirror: {
      tasks: Number(stats[0].n),
      lastSync: mirrorState?.since ? new Date(mirrorState.since).toISOString() : null,
      caughtUp: !!mirrorState && mirrorState.page === 0 && mirrorState.since > 0,
    },
  };
}
