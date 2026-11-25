'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PipelinePayload, PipelineTeam } from '@/lib/pipeline';

// One color per status (by rank in the totals), so a status keeps its color across teams
const PALETTE = ['#6366f1', '#a855f7', '#f59e0b', '#0ea5e9', '#10b981', '#ef4444', '#ec4899', '#84cc16', '#14b8a6', '#f97316', '#64748b', '#8b5cf6'];
const fmtDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const cap = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());

export default function Briefs() {
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [data, setData] = useState<PipelinePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState({ from: '', to: '' });
  const [picking, setPicking] = useState(false);
  const seq = useRef(0);
  const load = useCallback(async (r: typeof range) => {
    const mine = ++seq.current;
    try {
      const res = await fetch(`/api/briefs${r ? `?from=${r.from}&to=${r.to}` : ''}`, { cache: 'no-store' });
      const json = await res.json();
      if (mine !== seq.current) return;
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setData(json); setError(null);
    } catch (e) { if (mine === seq.current) setError(e instanceof Error ? e.message : 'Failed to load'); }
  }, []);
  useEffect(() => { load(range); const id = setInterval(() => load(range), 5 * 60_000); return () => clearInterval(id); }, [range, load]);

  const color = (s: string) => PALETTE[Math.max(0, data?.statusOrder.indexOf(s) ?? 0) % PALETTE.length];
  const internal = (data?.teams ?? []).filter(t => t.group !== 'Agency');
  const agency = (data?.teams ?? []).filter(t => t.group === 'Agency');
  const over = (data?.teams ?? []).filter(t => (t.weeksQueued ?? 0) > 1);

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <div className="crumb">Capacity</div>
          <h1>Briefs &amp; pipeline</h1>
          <p className="sub">Briefs in each team&apos;s queue (every status before the final asset is delivered) against what its editors finish in a week</p>
        </div>
      </header>
      <section className="week-nav">
        <div className="wk-label">{data ? <><span className="muted-l">Created / delivered in</span><strong>{fmtDay(data.from)} – {fmtDay(data.to)}</strong></> : 'Loading…'}</div>
        <button className={`wk-custom ${picking || range ? 'on' : ''}`} onClick={() => { if (data) setDraft({ from: data.from, to: data.to }); setPicking(p => !p); }}>📅 Custom dates</button>
        {range && <button className="wk-today" onClick={() => { setRange(null); setPicking(false); }}>Back to this month</button>}
      </section>
      {picking && (
        <section className="range-pick card">
          <form className="rp-form" onSubmit={e => { e.preventDefault(); if (draft.from && draft.to && draft.from <= draft.to) { setRange(draft); setPicking(false); } }}>
            <label>From<input type="date" value={draft.from} onChange={e => setDraft(d => ({ ...d, from: e.target.value }))} /></label>
            <label>To<input type="date" value={draft.to} onChange={e => setDraft(d => ({ ...d, to: e.target.value }))} /></label>
            <button type="submit" className="rp-apply" disabled={!draft.from || !draft.to || draft.from > draft.to}>Apply</button>
            <span className="muted">The queue is always as of now; the dates only change “created” and “delivered”.</span>
          </form>
        </section>
      )}
      {error && <div className="banner">Couldn&apos;t refresh: {error}</div>}
      {!data && !error && <div className="empty">Loading…</div>}
      {data && (
        <>
          {(!data.mirror.pipelineSynced || !data.mirror.agencySynced) && (
            <div className="banner soft">ClickUp is still syncing {!data.mirror.pipelineSynced ? 'the pipeline lists' : ''}{!data.mirror.pipelineSynced && !data.mirror.agencySynced ? ' and ' : ''}{!data.mirror.agencySynced ? 'the agency workspace' : ''}; numbers fill in over the next runs.</div>
          )}
          <section className="stats stats-6">
            <Stat label="Briefs in queue" value={data.totals.queue} sub="all teams, right now" />
            <Stat label="Waiting for an editor" value={data.totals.waiting} sub="no Editor set yet" />
            <Stat label="With an editor" value={data.totals.withEditor} sub="assigned, not delivered" />
            <Stat label="Created" value={data.totals.created} sub="in the selected dates" />
            <Stat label="Delivered" value={data.totals.delivered} sub="in the selected dates" good />
            <Stat label="Teams over capacity" value={over.length} sub={over.length ? over.slice(0, 2).map(t => `${t.name} ${t.weeksQueued} wk`).join(' · ') : 'every queue fits in a week'} warn={over.length > 0} />
          </section>
          <Section title="Internal" teams={internal} color={color} open={open} setOpen={setOpen} />
          <Section title="Agency" teams={agency} color={color} open={open} setOpen={setOpen} />
          <p className="cap-foot">
            Queue = tasks with no Asset Delivered Date that aren&apos;t closed in ClickUp; idea statuses (Shelved Ideas, High Intent Ideas) are left out. Weeks queued = queue ÷ one week of the team&apos;s capacity
            (editors × KPI); over 1 week means more briefs than the team can finish this week. Stale = queued and created more than 60 days ago.
            Agency capacity can&apos;t be measured yet, so agency teams show the queue only.
          </p>
        </>
      )}
    </main>
  );
}

function Section({ title, teams, color, open, setOpen }: { title: string; teams: PipelineTeam[]; color: (s: string) => string; open: string | null; setOpen: (s: string | null) => void }) {
  const total = teams.reduce((a, t) => a + t.queue, 0);
  return (
    <>
      <div className="sec-h"><h2>{title}</h2><span>{teams.length} teams · {total} briefs in queue</span></div>
      <div className="card table-frame">
        <table className="dtable">
          <thead>
            <tr><th>Team</th><th>Queue by status</th><th className="r">In queue</th><th className="r">Waiting for editor</th><th className="r">With editor</th>
              <th className="r">Capacity / week</th><th className="r">Weeks queued</th><th className="r">Created</th><th className="r">Delivered</th><th className="r">Stale</th></tr>
          </thead>
          <tbody>
            {teams.map(t => {
              const isOpen = open === t.id;
              const wk = t.weeksQueued;
              return (
                <FragmentRow key={t.id}>
                  <tr className={`drow ${isOpen ? 'open' : ''}`} onClick={() => setOpen(isOpen ? null : t.id)} aria-expanded={isOpen}>
                    <td className="nowrap"><b>{t.name}</b></td>
                    <td style={{ minWidth: 200 }}>
                      <div className="pipe" title={t.statuses.map(s => `${cap(s.status)}: ${s.n}`).join('\n')}>
                        {t.statuses.map(s => <i key={s.status} style={{ width: `${t.queue ? (s.n / t.queue) * 100 : 0}%`, background: color(s.status) }} />)}
                      </div>
                    </td>
                    <td className="r"><b>{t.queue}</b></td>
                    <td className="r">{t.waiting}</td>
                    <td className="r">{t.withEditor}</td>
                    <td className="r">{t.weekCapacity ?? <span className="faint" title="Can't be measured yet">—</span>}</td>
                    <td className="r">{wk == null ? <span className="faint">—</span> : <span className={`weeks ${wk > 1 ? 'hi' : wk < 0.4 ? 'lo' : 'ok'}`}>{wk.toFixed(1)} wk</span>}</td>
                    <td className="r">{t.createdInPeriod}</td>
                    <td className="r">{t.deliveredInPeriod}</td>
                    <td className="r">{t.stale ? <span className="pill-n warn" title="Queued and created over 60 days ago">{t.stale}</span> : <span className="faint">0</span>}</td>
                  </tr>
                  {isOpen && (
                    <tr className="dsub"><td colSpan={10}>
                      {t.statuses.length ? (
                        <div className="status-grid">
                          {t.statuses.map(s => (
                            <div key={s.status} className="status-item"><span className="dot" style={{ background: color(s.status) }} />{cap(s.status)}<b>{s.n}</b></div>
                          ))}
                        </div>
                      ) : <p className="muted">Nothing in the queue.</p>}
                    </td></tr>
                  )}
                </FragmentRow>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }

function Stat({ label, value, sub, warn, good }: { label: string; value: number; sub?: string; warn?: boolean; good?: boolean }) {
  return (
    <div className={`stat ${warn ? 'warn' : ''} ${good ? 'good' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value.toLocaleString()}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
