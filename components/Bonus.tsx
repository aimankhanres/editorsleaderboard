'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BonusPayload, Line, Scorecard } from '@/lib/bonus';
import { initials, money } from '@/lib/format';
import { TEAMS } from '@/lib/teams';

const GROUP_OF = new Map(TEAMS.map(t => [t.name, t.group]));

const TIER_LABEL = { lead: 'Lead Editor', senior: 'Senior Editor', editor: 'Base Editor' } as const;
const fmtPct = (n: number) => `${Math.round(n * 10) / 10}%`;
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const thisMonth = () => new Date().toISOString().slice(0, 7);

/** Editor Incentive Program: each person's monthly scorecard, as % of base pay */
export default function Bonus() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<BonusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<'all' | 'internal' | 'agency'>('all');
  // a team group (Resizing / Iterations / Internal / Variations) or one agency team; '' = everyone in the scope
  const [sub, setSub] = useState('');
  const pickScope = (s: 'all' | 'internal' | 'agency') => { setScope(s); setSub(''); };
  const [level, setLevel] = useState<'all' | 'editor' | 'senior' | 'lead'>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [password, setPassword] = useState('');

  const load = useCallback(async (m: string) => {
    setData(d => (d && d.month === m ? d : null));
    try {
      const res = await fetch(`/api/bonus?month=${m}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setData(json); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
  }, []);
  useEffect(() => { load(month); }, [month, load]);

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => (data?.people ?? []).filter(p =>
    (scope === 'all' || (scope === 'agency') === (p.group === 'Agency'))
    && (!sub || (scope === 'agency' ? p.teams.includes(sub) : p.teams.some(t => GROUP_OF.get(t) === sub)))
    && (level === 'all' || p.tier === level)
    && (!q || `${p.name} ${p.teams.join(' ')}`.toLowerCase().includes(q))), [data, scope, level, q, sub]);
  // Buttons under All / Internal / Agency: the internal groups, or the agency teams
  const subs = scope === 'agency' ? TEAMS.filter(t => t.group === 'Agency').map(t => t.name)
    : [...new Set(TEAMS.filter(t => scope === 'all' || t.group !== 'Agency').map(t => t.group))];
  const avg = rows.length ? rows.reduce((a, p) => a + p.total / p.max, 0) / rows.length : 0;
  const full = rows.filter(p => p.total >= p.max - 0.01).length;
  const zero = rows.filter(p => p.total < 0.01).length;

  const saveManual = async (p: Scorecard, line: Line, value: number | null) => {
    const res = await fetch('/api/bonus/manual', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, key: p.key, line: line.id, value, password }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error ?? 'Save failed'); return; }
    await load(month);
  };

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <div className="crumb">People</div>
          <h1>Bonus</h1>
          <p className="sub">Editor Incentive Program: each level&apos;s scorecard as a % of base pay. Paid on the 15th for the previous month.</p>
        </div>
      </header>

      <div className="period-row">
        <div className="drp-bar">
          <button type="button" className="drp-step" aria-label="Previous month" onClick={() => setMonth(m => shiftMonth(m, -1))}>‹</button>
          <span className="drp-btn" style={{ cursor: 'default' }}>
            <span className="drp-dates">{monthName(month)}</span>
            {data?.current && <span className="wk-tag">in progress</span>}
          </span>
          <button type="button" className="drp-step" aria-label="Next month" disabled={month >= thisMonth()} onClick={() => setMonth(m => shiftMonth(m, 1))}>›</button>
        </div>
        {month === thisMonth() && <button className="wk-today" onClick={() => setMonth(shiftMonth(thisMonth(), -1))}>Last month (payable now)</button>}
        {month < '2026-10' && <span className="muted">Tracking starts October 2026</span>}
      </div>

      {error && <div className="banner">{error}</div>}
      {!data && !error && <div className="empty">Loading…</div>}
      {data && (
        <>
          <section className="stats">
            <Stat label="People on a scorecard" value={`${rows.length}`} sub={`${rows.filter(p => p.tier === 'editor').length} editors · ${rows.filter(p => p.tier === 'senior').length} seniors · ${rows.filter(p => p.tier === 'lead').length} leads`} />
            <Stat label="Average bonus earned" value={`${Math.round(avg * 100)}%`} sub="of each person's max bonus" accent />
            <Stat label="At full bonus" value={`${full}`} sub="every line at target" />
            <Stat label="Earning nothing yet" value={`${zero}`} sub={data.current ? 'month still in progress' : 'no line reached'} warn={zero > 0} />
          </section>

          <section className="controls cap-controls">
            <div className="seg" role="tablist" aria-label="Internal or agency">
              {(['all', 'internal', 'agency'] as const).map(k => <button key={k} role="tab" aria-selected={scope === k} className={scope === k ? 'on' : ''} onClick={() => pickScope(k)}>{k === 'all' ? 'All' : k[0].toUpperCase() + k.slice(1)}</button>)}
            </div>
            <div className="seg small" role="tablist" aria-label="Level">
              {(['all', 'editor', 'senior', 'lead'] as const).map(k => <button key={k} role="tab" aria-selected={level === k} className={level === k ? 'on' : ''} onClick={() => setLevel(k)}>{k === 'all' ? 'All levels' : TIER_LABEL[k]}s</button>)}
            </div>
            <input className="search" type="search" placeholder="Search name or team" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search people" />
          </section>

          <nav className="teams cap-team-chips" role="tablist" aria-label="Team">
            <button role="tab" aria-selected={!sub} className={!sub ? 'on' : ''} onClick={() => setSub('')}>{scope === 'all' ? 'All teams' : scope === 'internal' ? 'All internal teams' : 'All agency teams'}</button>
            {subs.map(g => <button key={g} role="tab" aria-selected={sub === g} className={sub === g ? 'on' : ''} onClick={() => setSub(g)}>{g}</button>)}
          </nav>

          <div className="card table-frame">
            <table className="dtable">
              <thead>
                <tr><th>Person</th><th>Level</th><th>Bonus (% of base pay)</th>
                  <th className="r">Edits</th><th className="r">Per week</th>
                  <th className="r" title="Tracked, not paid (for now)">Ad spend</th><th className="r" title="Tracked, not paid (for now)">Winners</th></tr>
              </thead>
              <tbody>
                {rows.map(p => {
                  const isOpen = open === p.key;
                  return (
                    <Fragment key={p.key}>
                      <tr className={`drow ${isOpen ? 'open' : ''}`} onClick={() => setOpen(isOpen ? null : p.key)} aria-expanded={isOpen}>
                        <td><div className="who-cell"><span className={`avatar tier-${p.tier}`} style={{ width: 32, height: 32, fontSize: 12 }}>{initials(p.name)}</span>
                          <div><div className="name">{p.name}</div><div className="role">{p.teams.join(' + ')}</div></div></div></td>
                        <td><span className={`tier-badge ${p.tier}`}>{TIER_LABEL[p.tier]}</span></td>
                        <td style={{ minWidth: 220 }}>
                          <div className="bonus-bar"><span className="bb-t"><i style={{ width: `${(p.total / p.max) * 100}%` }} /></span>
                            <b>{fmtPct(p.total)}</b><small>of {p.max}%</small></div>
                        </td>
                        <td className="r">{p.edits}</td>
                        <td className="r">{p.perWeek.toFixed(1)}</td>
                        <td className="r faint">{p.tracked.spend != null ? money(p.tracked.spend) : '—'}</td>
                        <td className="r faint">{p.tracked.winners ?? '—'}</td>
                      </tr>
                      {isOpen && (
                        <tr className="dsub"><td colSpan={7}>
                          <table className="score-table">
                            <thead><tr><th>Scorecard line</th><th className="r">Weight</th><th>Result</th><th>Target</th><th className="r">Earned</th></tr></thead>
                            <tbody>
                              {p.lines.map(l => (
                                <tr key={l.id}>
                                  <td><b>{l.label}</b>{l.basis && <div className="muted" style={{ fontSize: 12 }}>{l.basis}</div>}</td>
                                  <td className="r">{l.weight}%</td>
                                  <td>{l.manual ? <ManualInput line={l} onSave={v => saveManual(p, l, v)} /> : l.value}</td>
                                  <td className="muted">{l.target}</td>
                                  <td className="r"><span className={`pill-n ${l.earned >= l.weight - 0.01 ? 'win' : l.earned > 0 ? '' : 'warn'}`}>{fmtPct(l.earned)}</span></td>
                                </tr>
                              ))}
                              <tr><td><b>Total</b></td><td className="r">{p.max}%</td><td /><td /><td className="r"><b>{fmtPct(p.total)}</b></td></tr>
                            </tbody>
                          </table>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {!rows.length && <div className="empty">Nobody matches.</div>}
          </div>

          <div className="bonus-foot">
            <input className="search" type="password" placeholder="Settings password (to score blocker lines)" value={password} onChange={e => setPassword(e.target.value)} aria-label="Settings password" />
            <p className="cap-foot">
              {data.rules.close}. Output: edits finished in the month (Edit Complete Date) ÷ {data.weeks} weeks. Revision turnaround: time in revision statuses per round
              ≤ {data.rules.revisionHours}h. Quality: ≤ {data.rules.maxRevisions} revision rounds (ClickUp Total Revisions). Review turnaround: time in review statuses per
              round ≤ {data.rules.reviewHours}h. Backlog health: ≤ {data.rules.backlogHours}h. Blocker lines are scored by hand. Ad spend and winners are tracked, not paid.
              Data coverage this month: {data.coverage.tasks} finished edits, {data.coverage.withRevisions} with a revision count, {data.coverage.withStatusTime} with status times.
            </p>
          </div>
        </>
      )}
    </main>
  );
}

function ManualInput({ line, onSave }: { line: Line; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(line.value.endsWith('%') ? line.value.replace('%', '') : '');
  return (
    <span className="manual-in" onClick={e => e.stopPropagation()}>
      <input type="number" min={0} max={100} placeholder="0–100" value={v} onChange={e => setV(e.target.value)} aria-label={`${line.label} score`} />%
      <button className="btn-ghost small" onClick={() => onSave(v === '' ? null : Number(v))}>Save</button>
    </span>
  );
}

function Fragment({ children }: { children: React.ReactNode }) { return <>{children}</>; }

function Stat({ label, value, sub, warn, accent }: { label: string; value: string; sub?: string; warn?: boolean; accent?: boolean }) {
  return (
    <div className={`stat ${warn ? 'warn' : ''} ${accent ? 'accent' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
