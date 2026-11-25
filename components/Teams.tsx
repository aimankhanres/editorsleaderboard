'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LeaderboardPayload, TeamBoard } from '@/lib/types';
import { initials, money } from '@/lib/format';
import PeriodBar, { type Period } from './PeriodBar';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const TIER = { lead: 'Lead', senior: 'Senior', editor: 'Editor' } as const;

/** Spend per team: every internal team and every agency team on its own card */
export default function Teams() {
  const [period, setPeriod] = useState<Period>({ month: thisMonth(), range: null, channel: 'meta' });
  const [data, setData] = useState<LeaderboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const load = useCallback(async (p: Period) => {
    const mine = ++seq.current;
    const qs = new URLSearchParams({ channel: p.channel, ...(p.range ? { from: p.range.from, to: p.range.to } : { month: p.month }) });
    try {
      const res = await fetch(`/api/leaderboard?${qs}`, { cache: 'no-store' });
      const json = await res.json();
      if (mine !== seq.current) return;
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setData(json); setError(null);
    } catch (e) { if (mine === seq.current) setError(e instanceof Error ? e.message : 'Failed to load'); }
  }, []);
  useEffect(() => { load(period); }, [period, load]);

  const teams = data?.teams ?? [];
  const internal = teams.filter(t => t.group !== 'Agency');
  const agency = teams.filter(t => t.group === 'Agency');
  const sum = (ts: TeamBoard[]) => ts.reduce((a, t) => a + t.spend, 0);
  const tI = sum(internal), tA = sum(agency);
  const best = [...teams].map(t => ({ t, per: perEditor(t) })).sort((a, b) => b.per - a.per)[0];
  const review = data ? data.total - data.attributed : 0;

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <div className="crumb">Attribution</div>
          <h1>Teams</h1>
          <p className="sub">Spend credited to each team: internal teams and agency teams side by side</p>
        </div>
      </header>
      <PeriodBar value={period} months={data?.months ?? [period.month]} onChange={setPeriod} min={data?.dataFrom} max={data?.dataTo} />
      {error && <div className="banner">Couldn&apos;t refresh: {error}</div>}
      {!data && !error && <div className="empty">Loading…</div>}
      {data && (
        <>
          <section className="stats">
            <Stat label="Internal teams" value={money(tI)} sub={`${data.attributed ? Math.round((tI / data.attributed) * 100) : 0}% of ${money(data.attributed)} credited · ${internal.length} teams`} />
            <Stat label="Agency teams" value={money(tA)} sub={`${data.attributed ? Math.round((tA / data.attributed) * 100) : 0}% of ${money(data.attributed)} credited · ${agency.length} teams`} />
            <Stat label="Best spend per editor" value={best ? money(best.per) : '—'} sub={best?.t.name ?? ''} accent />
            <Stat label="Not credited yet" value={money(review)} sub="ads in Needs review on Editors" warn={review > 0} />
          </section>
          <Section title="Internal" teams={internal} total={tI} />
          <Section title="Agency" teams={agency} total={tA} note="Agency briefs (6-digit IDs) are credited to the original editor in the agency's ClickUp. When Resizing resized them, the same spend also counts on the Resizing board, so Internal + Agency can add up to more than the total credited." />
          <p className="cap-foot">
            A person on two teams counts on each team only for briefs from that team&apos;s ClickUp board (task origin); briefs from other lists count
            on their first team. Click a team to open it on the Editors screen.
          </p>
        </>
      )}
    </main>
  );
}

function perEditor(t: TeamBoard) {
  const n = t.editors.filter(e => e.spend > 0).length;
  return n ? t.spend / n : 0;
}

function Section({ title, teams, total, note }: { title: string; teams: TeamBoard[]; total: number; note?: string }) {
  return (
    <>
      <div className="sec-h"><h2>{title}</h2><span>{teams.length} teams · {money(total)}</span></div>
      {note && <p className="muted sec-note">{note}</p>}
      <div className="team-grid">
        {[...teams].sort((a, b) => b.spend - a.spend).map(t => {
          const active = t.editors.filter(e => e.spend > 0);
          const counted = t.editors.filter(e => e.inClickUp !== false).length;
          return (
            <Link key={t.id} href={`/#${t.id}`} className={`card team-card ${t.group === 'Agency' ? 'agency' : ''}`}>
              <div className="tc-h"><b>{t.name}</b><span className={`chip ${t.group === 'Agency' ? 'amb' : ''}`}>{t.group}</span></div>
              <div className="tc-big">{money(t.spend)}</div>
              <div className="tc-row">
                <span><b>{t.winners}</b> winners</span>
                <span><b>{active.length}</b>/{t.editors.length} editors with spend</span>
                <span><b>{money(perEditor(t))}</b> / editor</span>
              </div>
              <div className="tc-top">
                {active.slice(0, 3).map(e => (
                  <div key={e.key}>
                    <span className="who-mini"><span className={`avatar tier-${e.tier ?? 'editor'}`} style={{ width: 22, height: 22, fontSize: 9.5 }}>{initials(e.name)}</span>{e.name}
                      {e.tier && e.tier !== 'editor' && <span className={`tier-badge ${e.tier}`}>{TIER[e.tier]}</span>}</span>
                    <b>{money(e.spend)}</b>
                  </div>
                ))}
                {!active.length && <div className="muted">No spend credited in this period</div>}
              </div>
              {counted < t.editors.length && <div className="tc-lock">{t.editors.length - counted} of {t.editors.length} editors aren&apos;t in Resilia&apos;s ClickUp</div>}
            </Link>
          );
        })}
      </div>
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
