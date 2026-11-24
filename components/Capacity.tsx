'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CapacityMember, CapacityPayload, CapacityTeam, Pace } from '@/lib/capacity';
import { ago, initials } from '@/lib/format';
import Nav from './Nav';

const POLL_MS = 5 * 60_000;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PACE: Record<Pace, { label: string; cls: string }> = {
  met: { label: 'KPI met', cls: 'met' },
  on: { label: 'On pace', cls: 'on' },
  behind: { label: 'Behind', cls: 'behind' },
  none: { label: 'Not tracked', cls: 'none' },
};

const fmtDay = (ymd: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const dowOf = (ymd: string) => (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon=0
const spanDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5) + 1;
type Range = { from: string; to: string };

export default function Capacity() {
  const [week, setWeek] = useState<string | null>(null);
  const [range, setRange] = useState<Range | null>(null);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<Range>({ from: '', to: '' });
  const [showIdle, setShowIdle] = useState(false);
  const [data, setData] = useState<CapacityPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<string>('All');
  const [query, setQuery] = useState('');
  const seq = useRef(0);

  const load = useCallback(async (w: string | null, r: Range | null) => {
    const mine = ++seq.current;
    try {
      const qs = r ? `?from=${r.from}&to=${r.to}` : w ? `?week=${w}` : '';
      const res = await fetch(`/api/capacity${qs}`, { cache: 'no-store' });
      const json = await res.json();
      if (mine !== seq.current) return;
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setData(json); setError(null);
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    try { const g = localStorage.getItem('capGroup'); if (g) setGroup(g); } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => {
    load(week, range);
    const id = setInterval(() => load(week, range), POLL_MS);
    return () => clearInterval(id);
  }, [week, range, load]);
  // A saved tab that no longer exists (tabs were renamed) falls back to All
  useEffect(() => { if (data && group !== 'All' && !data.teams.some(t => (t.group === 'Resizing' ? 'Resizing' : t.name) === group)) setGroup('All'); }, [data, group]);
  const pickGroup = (g: string) => { setGroup(g); try { localStorage.setItem('capGroup', g); } catch { /* ignore */ } };

  // Tabs: All, Resizing (Resizing + Rips boards), then every other team on its own tab
  const tabOf = (t: CapacityTeam) => (t.group === 'Resizing' ? 'Resizing' : t.name);
  const groups = data ? ['All', ...new Set(data.teams.map(tabOf))] : ['All'];
  const q = query.trim().toLowerCase();
  const teams = (data?.teams ?? [])
    .filter(t => group === 'All' || tabOf(t) === group)
    .map(t => (q ? { ...t, members: t.members.filter(m => m.name.toLowerCase().includes(q)) } : t))
    .filter(t => !q || t.members.length);
  const stale = data != null && (range ? data.mode !== 'range' || data.week !== range.from || data.weekEnd !== range.to
    : data.mode !== 'week' || (week != null && data.week !== week));
  const isRange = data?.mode === 'range';
  const period = isRange ? 'this period' : 'this week';
  const shift = (dir: 1 | -1) => {
    if (!data) return;
    if (isRange) { const n = spanDays(data.week, data.weekEnd) * dir; setRange({ from: addDays(data.week, n), to: addDays(data.weekEnd, n) }); }
    else setWeek(addDays(data.week, 7 * dir));
  };
  const openPicker = () => { if (data) setDraft({ from: data.week, to: data.weekEnd }); setPicking(p => !p); };
  const draftDays = draft.from && draft.to ? spanDays(draft.from, draft.to) : 0;
  const draftOk = draftDays >= 1 && draftDays <= (data?.maxDays ?? 92);
  const applyRange = (r: Range) => { setRange(r); setPicking(false); };
  const backToWeek = () => { setRange(null); setWeek(null); setPicking(false); };
  const preset = (n: number) => { if (data) applyRange({ from: addDays(data.today, -(n - 1)), to: data.today }); };
  const monthToDate = () => { if (data) applyRange({ from: `${data.today.slice(0, 8)}01`, to: data.today }); };
  // Summary cards follow the selected tab (each person once, like the company totals)
  const c = (() => {
    if (!data || group === 'All') return data?.company;
    const people = new Map<string, CapacityMember>();
    for (const t of data.teams.filter(t => tabOf(t) === group)) for (const m of t.members) if (m.inClickUp && !people.has(m.key)) people.set(m.key, m);
    const p = [...people.values()];
    const sum = (f: (x: CapacityMember) => number) => p.reduce((a, x) => a + f(x), 0);
    return { editors: p.length, done: sum(x => x.done), target: sum(x => x.target), expected: sum(x => x.expected),
      remaining: sum(x => x.remaining), open: sum(x => x.open), behind: p.filter(x => x.pace === 'behind').length };
  })();
  // Headcount, idle editors and backlogged pipelines for the selected tab (each person once)
  const view = (() => {
    const inView = (data?.teams ?? []).filter(t => group === 'All' || tabOf(t) === group);
    const everyone = new Map<string, CapacityMember>();
    for (const t of inView) for (const m of t.members) {
      const prev = everyone.get(m.key);
      if (!prev || (m.inClickUp && !prev.inClickUp)) everyone.set(m.key, m);
    }
    const all = [...everyone.values()];
    const tracked = all.filter(m => m.inClickUp);
    const idle = tracked.filter(m => m.open === 0).sort((a, b) => a.name.localeCompare(b.name));
    const backlogged = inView.filter(t => t.backlog > 0).sort((a, b) => b.backlog - a.backlog);
    return { total: all.length, tracked: tracked.length, idle, backlogged, pipelines: inView.filter(t => t.tracked > 0).length,
      backlog: backlogged.reduce((a, t) => a + t.backlog, 0) };
  })();

  return (
    <main className="wrap">
      <header className="top">
        <div className="title-row">
          <Nav />
          <div>
            <h1>Editing Capacity</h1>
            <p className="sub">Edits finished per editor vs KPI · <strong>Resizing 2 a day (14 a week)</strong> · every other team <strong>1 a day (5 a week)</strong></p>
          </div>
        </div>
        <div className="sync">
          {data?.mirror && (
            <span className={`pill ${data.mirror.caughtUp ? '' : 'demo'}`} title={`${data.mirror.tasks.toLocaleString()} ClickUp tasks with an editor`}>
              <span className={`dot ${data.mirror.caughtUp ? 'ok' : 'err'}`} />
              {data.mirror.caughtUp ? `ClickUp synced ${data.mirror.lastSync ? ago(data.mirror.lastSync) : ''}` : 'ClickUp sync catching up…'}
            </span>
          )}
        </div>
      </header>

      <section className="week-nav">
        <button className="wk-btn" aria-label={isRange ? 'Previous period' : 'Previous week'} onClick={() => shift(-1)}>‹</button>
        <div className="wk-label">
          {data ? <><strong>{fmtDay(data.week, data.week.slice(0, 4) !== data.weekEnd.slice(0, 4) ? { month: 'short', day: 'numeric', year: 'numeric' } : undefined)} – {fmtDay(data.weekEnd)}</strong>
            {isRange ? <span className="wk-tag">{data.days.length} days</span> : data.current ? <span className="wk-tag">This week</span> : null}</> : 'Loading…'}
        </div>
        <button className="wk-btn" aria-label={isRange ? 'Next period' : 'Next week'} disabled={!data || data.weekEnd >= data.today} onClick={() => shift(1)}>›</button>
        <button className={`wk-custom ${picking || isRange ? 'on' : ''}`} onClick={openPicker} aria-expanded={picking}>📅 Custom dates</button>
        {data && (isRange || !data.current) && <button className="wk-today" onClick={backToWeek}>Back to this week</button>}
      </section>
      {picking && data && (
        <section className="range-pick card">
          <div className="rp-presets">
            <button onClick={() => preset(7)}>Last 7 days</button>
            <button onClick={() => preset(14)}>Last 14 days</button>
            <button onClick={() => preset(30)}>Last 30 days</button>
            <button onClick={monthToDate}>This month</button>
          </div>
          <form className="rp-form" onSubmit={e => { e.preventDefault(); if (draftOk) applyRange(draft.from <= draft.to ? draft : { from: draft.to, to: draft.from }); }}>
            <label>From<input type="date" value={draft.from} max={data.today} onChange={e => setDraft(d => ({ ...d, from: e.target.value }))} /></label>
            <label>To<input type="date" value={draft.to} max={data.today} onChange={e => setDraft(d => ({ ...d, to: e.target.value }))} /></label>
            <button type="submit" className="rp-apply" disabled={!draftOk}>Apply</button>
            <span className="muted">{draftDays > data.maxDays ? `Pick up to ${data.maxDays} days` : 'Capacity = daily KPI × workdays in the range'}</span>
          </form>
        </section>
      )}

      {error && <div className="banner">Couldn&apos;t refresh: {error}</div>}
      {!data && !error && <div className="empty">Loading…</div>}

      {data && c && (
        <div className={stale ? 'loading' : ''}>
          <section className="stats">
            <Stat label="Edits done" value={`${c.done}`} sub={`of ${c.target} capacity · ${pct(c.done, c.target)}%`} />
            <Stat label={data.current ? 'Expected by today' : isRange ? 'Capacity' : 'Weekly capacity'} value={`${data.current ? c.expected : c.target}`}
              sub={data.current ? `${c.done >= c.expected ? '+' : ''}${c.done - c.expected} vs pace` : `${c.editors} editors tracked`} />
            <Stat label="Spare capacity" value={`${c.remaining}`} sub={data.current ? `edits still open ${period}` : 'edits short of KPI'} accent />
            <Stat label="Behind pace" value={`${c.behind}`} sub={`of ${c.editors} editors · ${c.open} tasks open`} warn={c.behind > 0} />
          </section>
          <section className="stats stats-3">
            <Stat label="Total editors" value={`${view.total}`} sub={view.total === view.tracked ? 'all counted in ClickUp' : `${view.tracked} counted · ${view.total - view.tracked} agency / not in ClickUp`} />
            <button className={`stat stat-btn ${view.idle.length ? 'warn' : ''}`} onClick={() => setShowIdle(v => !v)} aria-expanded={showIdle} disabled={!view.idle.length}>
              <div className="stat-label">Idle editors {view.idle.length > 0 && <span className="stat-more">{showIdle ? 'Hide' : 'Show'}</span>}</div>
              <div className="stat-value">{view.idle.length}</div>
              <div className="stat-sub">nothing in their queue right now</div>
            </button>
            <div className={`stat ${view.backlog ? 'warn' : ''}`}>
              <div className="stat-label">Backlog</div>
              <div className="stat-value">{view.backlog ? `+${view.backlog}` : '0'}</div>
              <div className="stat-sub" title={view.backlogged.map(t => `${t.name}: ${t.open} open vs ${t.weekCapacity} a week`).join('\n')}>
                {view.backlogged.length
                  ? `${view.backlogged.length} of ${view.pipelines} pipeline${view.pipelines === 1 ? '' : 's'}: ${view.backlogged.slice(0, 3).map(t => `${t.name} +${t.backlog}`).join(', ')}${view.backlogged.length > 3 ? '…' : ''}`
                  : `queue fits in a week's capacity`}
              </div>
            </div>
          </section>
          {showIdle && view.idle.length > 0 && (
            <div className="idle-chips card">
              {view.idle.map(m => <span key={m.key} className="idle-chip"><span className="avatar" style={{ width: 22, height: 22, fontSize: 9.5 }}>{initials(m.name)}</span>{m.name}<small>{m.done} done {period}</small></span>)}
            </div>
          )}

          <section className="controls cap-controls">
            <div className="control">
              <span className="control-label">Teams</span>
              <div className="seg cap-tabs" role="tablist" aria-label="Team">
                {groups.map(g => <button key={g} role="tab" aria-selected={group === g} className={group === g ? 'on' : ''} onClick={() => pickGroup(g)}>{g}</button>)}
              </div>
            </div>
            <input className="search" type="search" placeholder="Search editor" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search editors" />
          </section>

          {teams.map(t => <TeamCard key={`${t.id}-${data.week}`} team={t} data={data} forceOpen={!!q} />)}
          {!teams.length && <div className="empty">Nobody matches “{query}”.</div>}

          <p className="cap-foot">
            A task counts on its ClickUp <strong>Edit Complete Date</strong> (or Asset Delivered Date), in {data.timezone.replace('_', ' ')} time.
            A task with two editors counts for both. Open = assigned in the last 45 days and not finished.
            Idle = an editor with no open task right now. Backlog = a team&apos;s open tasks above one week of its capacity (editors × weekly KPI).
            Editors on two teams appear on both but count once in the totals above.
          </p>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, sub, warn, accent }: { label: string; value: string; sub?: string; warn?: boolean; accent?: boolean }) {
  return (
    <div className={`stat ${warn ? 'warn' : ''} ${accent ? 'accent' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function TeamCard({ team, data, forceOpen }: { team: CapacityTeam; data: CapacityPayload; forceOpen: boolean }) {
  const [open, setOpen] = useState(true);
  const shown = open || forceOpen;
  const untracked = team.members.filter(m => !m.inClickUp).length;
  const fill = Math.min(100, pct(team.done, team.target));
  const mark = Math.min(100, pct(team.expected, team.target));
  const maxHist = Math.max(1, ...team.history.map(h => Math.max(h.done, h.target)));
  const cols = { gridTemplateColumns: `minmax(210px, 1.6fr) repeat(${data.days.length}, ${data.days.length > 14 ? 34 : 46}px) 64px minmax(90px, 1fr) 54px 50px 100px` };
  const minW = 210 + data.days.length * ((data.days.length > 14 ? 34 : 46) + 8) + 470;
  const members = [...team.members].sort((a, b) => Number(b.inClickUp) - Number(a.inClickUp) || b.done - a.done || a.name.localeCompare(b.name));

  return (
    <section className="card cap-team">
      <button className="cap-head" onClick={() => setOpen(o => !o)} aria-expanded={shown}>
        <div className="cap-title">
          <h2>{team.name}</h2>
          <span className="kpi-chip">{team.kpi.perDay}/day · {team.kpi.perWeek}/week</span>
          {team.tracked > 0 && team.behind > 0 && <span className="behind-chip">{team.behind} behind</span>}
          {team.backlog > 0 && <span className="behind-chip" title={`${team.open} open tasks vs ${team.weekCapacity} a week of capacity`}>Backlog +{team.backlog}</span>}
          {team.tracked > 0 && team.idle > 0 && <span className="idle-tag" title="Editors with nothing in their queue right now">{team.idle} idle</span>}
        </div>
        {team.tracked > 0 ? (
          <div className="cap-summary">
            <div className="cap-progress" title={data.current ? `Expected by today: ${team.expected}` : undefined}>
              <div className="cap-bar"><span style={{ width: `${fill}%` }} />{data.current && <i style={{ left: `${mark}%` }} />}</div>
              <div className="cap-nums"><b>{team.done}</b> / {team.target} edits · <b>{team.remaining}</b> spare · <b>{team.open}</b> in queue</div>
            </div>
            <div className="spark" aria-label="Last 8 weeks, edits done vs capacity">
              {team.history.map(h => (
                <span key={h.week} title={`Week of ${fmtDay(h.week)}: ${h.done} / ${h.target}`} className={h.week === data.week ? 'cur' : ''}>
                  <i className="cap" style={{ height: `${(h.target / maxHist) * 100}%` }} />
                  <i className="done" style={{ height: `${(h.done / maxHist) * 100}%` }} />
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="cap-summary"><span className="muted">{team.measured
            ? 'Not in Resilia\'s ClickUp, so edits can\'t be counted'
            : 'Agency team: edits happen in the agency\'s ClickUp workspace, so they can\'t be counted here'}</span></div>
        )}
        <span className="chev">{shown ? '▾' : '▸'}</span>
      </button>

      {shown && (
        <div className="cap-scroll">
          <div className="cap-grid" role="table" aria-label={`${team.name} capacity`} style={{ minWidth: minW }}>
            <div className="cap-row cap-th" role="row" style={cols}>
              <span role="columnheader">Editor</span>
              {data.days.map((d, i) => (
                <span key={d} role="columnheader" className={`c-day ${d === data.today ? 'today' : ''} ${dowOf(d) >= team.workDays ? 'off' : ''}`} title={fmtDay(d, { weekday: 'long', month: 'short', day: 'numeric' })}>
                  {data.days.length > 14 ? DOW[dowOf(d)][0] : DOW[dowOf(d)]}<small>{i === 0 || d.endsWith('-01') ? fmtDay(d) : fmtDay(d, { day: 'numeric' })}</small>
                </span>
              ))}
              <span role="columnheader" className="r">Done</span>
              <span role="columnheader">Progress</span>
              <span role="columnheader" className="r">Spare</span>
              <span role="columnheader" className="r">Open</span>
              <span role="columnheader">Status</span>
            </div>
            {members.map(m => <MemberRow key={m.key} m={m} team={team} data={data} cols={cols} />)}
          </div>
          {untracked > 0 && team.measured && <p className="cap-note">{untracked} editor{untracked === 1 ? '' : 's'} on this team {untracked === 1 ? 'is' : 'are'} not in Resilia&apos;s ClickUp workspace (agency workspace), so their edits can&apos;t be counted here.</p>}
        </div>
      )}
    </section>
  );
}

function MemberRow({ m, team, data, cols }: { m: CapacityMember; team: CapacityTeam; data: CapacityPayload; cols: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  const fill = Math.min(100, pct(m.done, m.target));
  return (
    <div className={`cap-member ${m.inClickUp ? '' : 'untracked'} ${open ? 'open' : ''}`} role="rowgroup">
      <button className="cap-row" role="row" style={cols} onClick={() => m.inClickUp && setOpen(o => !o)} aria-expanded={m.inClickUp ? open : undefined} disabled={!m.inClickUp}>
        <span className="c-ed" role="cell">
          <span className="avatar" style={{ width: 30, height: 30, fontSize: 11.5 }}>{initials(m.name)}</span>
          <span className="who"><span className="name">{m.name}</span><span className="role">{m.inClickUp ? m.role : team.measured ? 'Not in Resilia ClickUp' : `${m.role} · agency workspace`}</span></span>
        </span>
        {m.days.map((n, i) => {
          const d = data.days[i];
          const future = d > data.today;
          const off = dowOf(d) >= team.workDays;
          const cls = !m.inClickUp || future ? 'blank' : n >= team.kpi.perDay ? 'hit' : n > 0 ? 'part' : off ? 'blank' : 'miss';
          return <span key={d} role="cell" className={`c-day cell ${cls} ${off ? 'off' : ''} ${d === data.today ? 'today' : ''}`}>{!m.inClickUp || future ? '' : n}</span>;
        })}
        <span role="cell" className="r c-done">{m.inClickUp ? <><b>{m.done}</b><small>/{m.target}</small></> : '—'}</span>
        <span role="cell" className="c-prog">{m.inClickUp && <span className="bar"><span style={{ width: `${fill}%` }} /></span>}</span>
        <span role="cell" className="r">{m.inClickUp ? m.remaining : '—'}</span>
        <span role="cell" className="r">{m.inClickUp ? m.open : '—'}</span>
        <span role="cell"><span className={`pace ${PACE[m.pace].cls}`}>{PACE[m.pace].label}</span></span>
      </button>
      {open && (
        <div className="cap-tasks">
          {m.tasks.length ? (
            <ul>
              {m.tasks.map(t => (
                <li key={t.url + t.day}><span className="t-day">{fmtDay(t.day, data.mode === 'range' ? { month: 'short', day: 'numeric' } : { weekday: 'short', day: 'numeric' })}</span><a href={t.url} target="_blank" rel="noreferrer">{t.name}</a></li>
              ))}
            </ul>
          ) : <p className="muted">No finished edits {data.mode === 'range' ? 'in this period' : 'this week'}.</p>}
        </div>
      )}
    </div>
  );
}
