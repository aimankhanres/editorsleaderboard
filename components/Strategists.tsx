'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StrategistPayload, StrategistRow } from '@/lib/strategists';
import { initials, money } from '@/lib/format';
import PeriodBar, { type Period } from './PeriodBar';

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function Strategists() {
  const [period, setPeriod] = useState<Period>({ month: thisMonth(), range: null, channel: 'all' });
  const [data, setData] = useState<StrategistPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [scope, setScope] = useState<'all' | 'internal' | 'agency'>('all');
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
  // Internal = internal and vibe TV pods; Agency = agency pods; ClickUp-only people (not on a pod list) show under All
  const scopeOf = (g: string) => (g === 'Agency' ? 'agency' : g === 'ClickUp only' ? 'other' : 'internal');
  const inScope = (s: StrategistRow) => scope === 'all' || scopeOf(s.group) === scope;
  const rows = (data?.strategists ?? []).filter(s => inScope(s) && (!q || s.name.toLowerCase().includes(q)));
  const scopeSpend = rows.reduce((a, s) => a + s.spend, 0);
  const top = data?.strategists[0]?.spend ?? 0;
  const winners = new Set((data?.strategists ?? []).flatMap(s => s.winners.map(w => w.adId))).size;
  const briefs = (data?.strategists ?? []).reduce((a, s) => a + s.briefs, 0);

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <div className="crumb">Attribution</div>
          <h1>Strategists</h1>
          <p className="sub">The <strong>pod in the ad name</strong> decides the strategist (a shared pod is one joint row); ads with no pod fall back to the ClickUp <strong>Strategist</strong> field</p>
        </div>
      </header>
      <PeriodBar value={period} months={data?.months ?? [period.month]} onChange={setPeriod} min={data?.dataFrom} max={data?.dataTo} />

      {error && <div className="banner">Couldn&apos;t refresh: {error}</div>}
      {!data && !error && <div className="empty">Loading…</div>}
      {data && (
        <>
          <section className="stats">
            <Stat label="Credited to strategists" value={money(data.withStrategist)} sub={`${data.total ? Math.round((data.withStrategist / data.total) * 100) : 0}% of ${money(data.total)} spend`} />
            <Stat label="From ad-name pods" value={money(data.byPod)} sub={`ClickUp Strategist field: ${money(data.byClickUp)}`} />
            <Stat label="Winners" value={`${winners}`} sub={`ads over ${money(data.winnerSpend)} · ${data.strategists.length} strategists`} accent />
            <Stat label="No strategist" value={money(data.noStrategist.spend)} sub={`${data.noStrategist.ads} ads with no pod and no ClickUp Strategist`} warn={data.noStrategist.spend > 0} />
          </section>

          <section className="controls cap-controls">
            <div className="seg" role="tablist" aria-label="Internal or agency">
              {(['all', 'internal', 'agency'] as const).map(k => (
                <button key={k} role="tab" aria-selected={scope === k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>
                  {k === 'all' ? 'All' : k === 'internal' ? 'Internal' : 'Agency'}
                </button>
              ))}
            </div>
            <span className="muted">{rows.length} strategist{rows.length === 1 ? '' : 's'} · {money(scopeSpend)}</span>
            <input className="search" type="search" placeholder="Search strategist" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search strategists" />
          </section>

          <div className="card table-frame">
            <table className="dtable">
              <thead>
                <tr><th>#</th><th>Strategist</th><th className="r">Spend</th><th className="r" title="Ads whose name carries this pod: matches a Triple Whale filter on the pod">From pods</th><th className="r" title="Ads with no pod in the name, credited through the ClickUp Strategist field">From ClickUp</th><th>Share</th><th className="r">Briefs</th><th className="r">Ads</th>
                  <th className="r">Winners</th><th className="r" title="Briefs that produced a winner ad">Hit rate</th><th>Top editors</th></tr>
              </thead>
              <tbody>
                {rows.map((s, i) => <Row key={s.key} s={s} i={i} top={top} open={open === s.key} onToggle={() => setOpen(open === s.key ? null : s.key)} />)}
              </tbody>
            </table>
            {!rows.length && <div className="empty">{q ? `Nobody matches “${query}”.` : 'No strategist spend in this period yet.'}</div>}
          </div>
          {data.unknownPods.length > 0 && (
            <div className="banner soft">Pods in ad names that aren&apos;t in the pod list (credited through ClickUp instead): {data.unknownPods.slice(0, 8).map(u => `Pod ${u.pod} (${money(u.spend)})`).join(', ')}</div>
          )}
          <p className="cap-foot">
            A pod in the ad name wins; a shared pod (Pod26 = Liran / Farwa) is its own row with the pod&apos;s full total. Ads with no pod use the ClickUp Strategist field (for agency briefs, the
            original agency task&apos;s). Every ad counts, with or without a brief ID or an editor. Winner = an ad with {money(data.winnerSpend)}+ spend in the period.
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
            <div><div className="name">{s.name}{!s.active && <span className="chip" style={{ marginLeft: 6 }}>inactive</span>}</div>
              <div className="role">{s.group}{s.pods.length ? ` · Pod ${s.pods.join(', ')}` : ''}{s.products.length ? ` · ${s.products.join(', ')}` : ''}</div></div>
          </div>
        </td>
        <td className="r money-cell">{money(s.spend)}</td>
        <td className="r">{s.podSpend ? money(s.podSpend) : <span className="faint">—</span>}</td>
        <td className="r">{s.clickupSpend ? money(s.clickupSpend) : <span className="faint">—</span>}</td>
        <td><div className="share-cell"><span className="bar"><span style={{ width: `${Math.max(2, top ? (s.spend / top) * 100 : 0)}%` }} /></span><small>{(s.share * 100).toFixed(1)}%</small></div></td>
        <td className="r">{s.briefs}</td>
        <td className="r">{s.ads}</td>
        <td className="r">{s.winners.length ? <span className="pill-n win">{s.winners.length}</span> : <span className="faint">0</span>}</td>
        <td className="r">{s.briefs ? `${Math.round((winBriefs / s.briefs) * 100)}%` : '—'}</td>
        <td><div className="chips">{s.editors.slice(0, 3).map(e => <span key={e.name} className="chip" title={money(e.spend)}>{e.name}</span>)}</div></td>
      </tr>
      {open && (
        <tr className="dsub"><td colSpan={11}>
          <div className="board-split">
            <div className="bs-item">
              <div className="bs-h"><span>Where the spend came from</span></div>
              <ul className="mini-list"><li><span>Pod in the ad name</span><b>{money(s.podSpend)}</b></li><li><span>ClickUp Strategist field</span><b>{money(s.clickupSpend)}</b></li></ul>
              <div className="bs-h" style={{ marginTop: 12 }}><span>Editors on their ads</span></div>
              <ul className="mini-list">{s.editors.map(e => <li key={e.name}><span>{e.name}</span><b>{money(e.spend)}</b></li>)}</ul>
            </div>
            {s.clickupAds.length > 0 && (
              <div className="bs-item" style={{ gridColumn: '1 / -1' }}>
                <div className="bs-h"><span>Biggest ads credited through ClickUp (no pod in the ad name)</span></div>
                <ul className="mini-list">{s.clickupAds.slice(0, 10).map(c => (
                  <li key={c.adName + c.briefId}><span className="ellip" title={c.adName}>{c.adName}</span>
                    <span className="mono">{c.taskUrl ? <a href={c.taskUrl} target="_blank" rel="noreferrer">{c.briefId}</a> : c.briefId}</span><b>{money(c.spend)}</b></li>
                ))}</ul>
              </div>
            )}
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
