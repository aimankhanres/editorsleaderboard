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

export default function Capacity() {
  const [week, setWeek] = useState<string | null>(null);
  const [data, setData] = useState<CapacityPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<string>('All');
  const [query, setQuery] = useState('');
  const seq = useRef(0);

  const load = useCallback(async (w: string | null) => {
    const mine = ++seq.current;
    try {
      const res = await fetch(`/api/capacity${w ? `?week=${w}` : ''}`, { cache: 'no-store' });
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
    load(week);
    const id = setInterval(() => load(week), POLL_MS);
    return () => clearInterval(id);
  }, [week, load]);
  const pickGroup = (g: string) => { setGroup(g); try { localStorage.setItem('capGroup', g); } catch { /* ignore */ } };

  const groups = data ? ['All', ...new Set(data.teams.map(t => t.group))] : ['All'];
  const q = query.trim().toLowerCase();
  const teams = (data?.teams ?? [])
    .filter(t => group === 'All' || t.group === group)
    .map(t => (q ? { ...t, members: t.members.filter(m => m.name.toLowerCase().includes(q)) } : t))
    .filter(t => !q || t.members.length);
  const stale = data != null && week != null && data.week !== week;
  const c = data?.company;

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
        <button className="wk-btn" aria-label="Previous week" onClick={() => data && setWeek(addDays(data.week, -7))}>‹</button>
        <div className="wk-label">
          {data ? <><strong>{fmtDay(data.week)} – {fmtDay(data.weekEnd)}</strong>{data.current ? <span className="wk-tag">This week</span> : null}</> : 'Loading…'}
        </div>
        <button className="wk-btn" aria-label="Next week" disabled={!data || data.current} onClick={() => data && setWeek(addDays(data.week, 7))}>›</button>
        {data && !data.current && <button className="wk-today" onClick={() => setWeek(null)}>Back to this week</button>}
      </section>

      {error && <div className="banner">Couldn&apos;t refresh: {error}</div>}
      {!data && !error && <div className="empty">Loading…</div>}

      {data && c && (
        <div className={stale ? 'loading' : ''}>
          <section className="stats">
            <Stat label="Edits done" value={`${c.done}`} sub={`of ${c.target} capacity · ${pct(c.done, c.target)}%`} />
            <Stat label={data.current ? 'Expected by today' : 'Weekly capacity'} value={`${data.current ? c.expected : c.target}`}
              sub={data.current ? `${c.done >= c.expected ? '+' : ''}${c.done - c.expected} vs pace` : `${c.editors} editors tracked`} />
            <Stat label="Spare capacity" value={`${c.remaining}`} sub={data.current ? 'edits still open this week' : 'edits short of KPI'} accent />
            <Stat label="Behind pace" value={`${c.behind}`} sub={`of ${c.editors} editors · ${c.open} tasks open`} warn={c.behind > 0} />
          </section>

          <section className="controls cap-controls">
            <div className="control">
              <span className="control-label">Teams</span>
              <div className="seg" role="tablist" aria-label="Team group">
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
  const members = [...team.members].sort((a, b) => Number(b.inClickUp) - Number(a.inClickUp) || b.done - a.done || a.name.localeCompare(b.name));

  return (
    <section className="card cap-team">
      <button className="cap-head" onClick={() => setOpen(o => !o)} aria-expanded={shown}>
        <div className="cap-title">
          <h2>{team.name}</h2>
          <span className="kpi-chip">{team.kpi.perDay}/day · {team.kpi.perWeek}/week</span>
          {team.tracked > 0 && team.behind > 0 && <span className="behind-chip">{team.behind} behind</span>}
        </div>
        {team.tracked > 0 ? (
          <div className="cap-summary">
            <div className="cap-progress" title={data.current ? `Expected by today: ${team.expected}` : undefined}>
              <div className="cap-bar"><span style={{ width: `${fill}%` }} />{data.current && <i style={{ left: `${mark}%` }} />}</div>
              <div className="cap-nums"><b>{team.done}</b> / {team.target} edits · <b>{team.remaining}</b> spare</div>
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
          <div className="cap-summary"><span className="muted">Not in Resilia&apos;s ClickUp, so tasks can&apos;t be counted yet</span></div>
        )}
        <span className="chev">{shown ? '▾' : '▸'}</span>
      </button>

      {shown && (
        <div className="cap-scroll">
          <div className="cap-grid" role="table" aria-label={`${team.name} capacity`}>
            <div className="cap-row cap-th" role="row">
              <span role="columnheader">Editor</span>
              {data.days.map((d, i) => (
                <span key={d} role="columnheader" className={`c-day ${d === data.today ? 'today' : ''} ${i >= team.workDays ? 'off' : ''}`}>
                  {DOW[i]}<small>{fmtDay(d, { day: 'numeric' })}</small>
                </span>
              ))}
              <span role="columnheader" className="r">Done</span>
              <span role="columnheader">Progress</span>
              <span role="columnheader" className="r">Spare</span>
              <span role="columnheader" className="r">Open</span>
              <span role="columnheader">Status</span>
            </div>
            {members.map(m => <MemberRow key={m.key} m={m} team={team} data={data} />)}
          </div>
          {untracked > 0 && <p className="cap-note">{untracked} editor{untracked === 1 ? '' : 's'} on this team {untracked === 1 ? 'is' : 'are'} not in Resilia&apos;s ClickUp workspace (agency workspace), so their edits can&apos;t be counted here.</p>}
        </div>
      )}
    </section>
  );
}

function MemberRow({ m, team, data }: { m: CapacityMember; team: CapacityTeam; data: CapacityPayload }) {
  const [open, setOpen] = useState(false);
  const fill = Math.min(100, pct(m.done, m.target));
  return (
    <div className={`cap-member ${m.inClickUp ? '' : 'untracked'} ${open ? 'open' : ''}`} role="rowgroup">
      <button className="cap-row" role="row" onClick={() => m.inClickUp && setOpen(o => !o)} aria-expanded={m.inClickUp ? open : undefined} disabled={!m.inClickUp}>
        <span className="c-ed" role="cell">
          <span className="avatar" style={{ width: 30, height: 30, fontSize: 11.5 }}>{initials(m.name)}</span>
          <span className="who"><span className="name">{m.name}</span><span className="role">{m.inClickUp ? m.role : 'Not in Resilia ClickUp'}</span></span>
        </span>
        {m.days.map((n, i) => {
          const d = data.days[i];
          const future = d > data.today;
          const off = i >= team.workDays;
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
                <li key={t.url + t.day}><span className="t-day">{fmtDay(t.day, { weekday: 'short', day: 'numeric' })}</span><a href={t.url} target="_blank" rel="noreferrer">{t.name}</a></li>
              ))}
            </ul>
          ) : <p className="muted">No finished edits this week.</p>}
        </div>
      )}
    </div>
  );
}
