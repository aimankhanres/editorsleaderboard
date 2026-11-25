'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StrategistPayload, StrategistRow } from '@/lib/strategists';
import { initials, money } from '@/lib/format';
import PeriodBar, { type Period } from './PeriodBar';

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function Strategists() {
  const [period, setPeriod] = useState<Period>({ month: thisMonth(), range: null, channel: 'meta' });
  const [data, setData] = useState<StrategistPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (p: Period) => {
    const mine = ++seq.current;
    const qs = new URLSearchParams({ channel: p.channel, ...(p.range ? { from: p.range.from, to: p.range.to } : { month: p.month }) });
    try {
      const res = await fetch(`/api/strategists?${qs}`, { cache: 'no-store' });
      const json = await res.json();
      if (mine !== seq.current) return;
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setData(json); setError(null);
    } catch (e) { if (mine === seq.current) setError(e instanceof Error ? e.message : 'Failed to load'); }
  }, []);
  useEffect(() => { load(period); }, [period, load]);

  const q = query.trim().toLowerCase();
  const rows = (data?.strategists ?? []).filter(s => !q || s.name.toLowerCase().includes(q));
  const top = data?.strategists[0]?.spend ?? 0;
  const winners = new Set((data?.strategists ?? []).flatMap(s => s.winners.map(w => w.adId))).size;
  const briefs = (data?.strategists ?? []).reduce((a, s) => a + s.briefs, 0);

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <div className="crumb">Attribution</div>
          <h1>Strategists</h1>
          <p className="sub">Spend on ads credited to editors, credited again to the brief&apos;s <strong>Strategist</strong> in ClickUp</p>
        </div>
      </header>
      <PeriodBar value={period} months={data?.months ?? [period.month]} onChange={setPeriod} min={data?.dataFrom} max={data?.dataTo} />

      {error && <div className="banner">Couldn&apos;t refresh: {error}</div>}
      {!data && !error && <div className="empty">Loading…</div>}
      {data && (
        <>
          <section className="stats">
            <Stat label="Credited to strategists" value={money(data.withStrategist)} sub={`of ${money(data.attributed)} credited to editors`} />
            <Stat label="Strategists" value={`${data.strategists.length}`} sub={`${briefs} briefs with spend`} />
            <Stat label="Winners" value={`${winners}`} sub={`ads over ${money(data.winnerSpend)}`} accent />
            <Stat label="No strategist set" value={money(data.noStrategist.spend)} sub={`${data.noStrategist.briefs} credited briefs without one`} warn={data.noStrategist.spend > 0} />
          </section>

          <section className="controls cap-controls">
            <span className="muted">{rows.length} strategist{rows.length === 1 ? '' : 's'}</span>
            <input className="search" type="search" placeholder="Search strategist" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search strategists" />
          </section>

          <div className="card scroll">
            <table className="dtable">
              <thead>
                <tr><th>#</th><th>Strategist</th><th className="r">Spend</th><th>Share</th><th className="r">Briefs</th><th className="r">Ads</th>
                  <th className="r">Winners</th><th className="r" title="Briefs that produced a winner ad">Hit rate</th><th>Top editors</th></tr>
              </thead>
              <tbody>
                {rows.map((s, i) => <Row key={s.key} s={s} i={i} top={top} open={open === s.key} onToggle={() => setOpen(open === s.key ? null : s.key)} />)}
              </tbody>
            </table>
            {!rows.length && <div className="empty">{q ? `Nobody matches “${query}”.` : 'No strategist spend in this period yet.'}</div>}
          </div>
          <p className="cap-foot">
            Only spend already credited to an editor counts (the ClickUp task was found and has an Editor). A task with two strategists splits
            its spend between them, like two editors. Winner = an ad with {money(data.winnerSpend)}+ spend in the period.
          </p>
        </>
      )}
    </main>
  );
}

function Row({ s, i, top, open, onToggle }: { s: StrategistRow; i: number; top: number; open: boolean; onToggle: () => void }) {
  const winBriefs = new Set(s.winners.map(w => w.briefId)).size;
  return (
    <>
      <tr className={`drow ${open ? 'open' : ''}`} onClick={onToggle} aria-expanded={open}>
        <td className={`rank-n r${i + 1}`}>{i + 1}</td>
        <td>
          <div className="who-cell">
            <span className="avatar strat" style={{ width: 32, height: 32, fontSize: 12 }}>{initials(s.name)}</span>
            <div><div className="name">{s.name}</div><div className="role">{s.products.join(' · ') || '—'}</div></div>
          </div>
        </td>
        <td className="r money-cell">{money(s.spend)}</td>
        <td><div className="share-cell"><span className="bar"><span style={{ width: `${Math.max(2, top ? (s.spend / top) * 100 : 0)}%` }} /></span><small>{(s.share * 100).toFixed(1)}%</small></div></td>
        <td className="r">{s.briefs}</td>
        <td className="r">{s.ads}</td>
        <td className="r">{s.winners.length ? <span className="pill-n win">{s.winners.length}</span> : <span className="faint">0</span>}</td>
        <td className="r">{s.briefs ? `${Math.round((winBriefs / s.briefs) * 100)}%` : '—'}</td>
        <td><div className="chips">{s.editors.slice(0, 3).map(e => <span key={e.name} className="chip" title={money(e.spend)}>{e.name}</span>)}</div></td>
      </tr>
      {open && (
        <tr className="dsub"><td colSpan={9}>
          <div className="board-split">
            <div className="bs-item">
              <div className="bs-h"><span>Editors on their briefs</span></div>
              <ul className="mini-list">{s.editors.map(e => <li key={e.name}><span>{e.name}</span><b>{money(e.spend)}</b></li>)}</ul>
            </div>
            <div className="bs-item" style={{ gridColumn: 'span 2' }}>
              <div className="bs-h"><span>Top briefs</span></div>
              <ul className="mini-list">{s.topBriefs.slice(0, 10).map(b => (
                <li key={b.briefId}><span className="mono">{b.briefId}</span>
                  <span className="ellip">{b.taskUrl ? <a href={b.taskUrl} target="_blank" rel="noreferrer">{b.taskName ?? 'Open task'}</a> : b.taskName}</span><b>{money(b.spend)}</b></li>
              ))}</ul>
            </div>
          </div>
        </td></tr>
      )}
    </>
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
