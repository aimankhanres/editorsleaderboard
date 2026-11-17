'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EditorRow, LeaderboardPayload, ReviewItem, ReviewKind, TeamBoard } from '@/lib/types';
import { ago, initials, money, monthLabel } from '@/lib/format';

const POLL_MS = 60_000;

const REVIEW_LABEL: Record<ReviewKind, { title: string; hint: string }> = {
  no_brief_id: { title: 'No brief ID in ad name', hint: 'Ad name has no OO-, AOG- or CIN- brief ID, so it cannot be linked to a ClickUp task.' },
  task_not_found: { title: 'Brief not found in ClickUp', hint: 'No task has this Brief ID. Usually a typo in the ad name or an empty Brief ID field.' },
  other_workspace: { title: 'Made in another ClickUp workspace', hint: '6-digit brief IDs come from a separate ClickUp workspace we cannot read, so the editor is unknown here.' },
  no_editor: { title: 'Editor field empty', hint: 'Task found, but nobody is set in its Editor field.' },
  pending: { title: 'Waiting for ClickUp lookup', hint: 'Will be resolved by an upcoming sync.' },
  name_mismatch: { title: 'Ad name mentions a different editor', hint: 'Already credited via ClickUp; check the Editor field is right.' },
};
const REVIEW_ORDER: ReviewKind[] = ['no_editor', 'task_not_found', 'no_brief_id', 'pending', 'other_workspace', 'name_mismatch'];

type View = string; // a team id, or 'review'

function readHash(): View | null {
  if (typeof window === 'undefined') return null;
  return window.location.hash.replace('#', '') || null;
}

export default function Leaderboard() {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<LeaderboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setViewState] = useState<View | null>(null);
  const [, tick] = useState(0);

  const setView = (v: View) => {
    setViewState(v);
    if (typeof window !== 'undefined') history.replaceState(null, '', `#${v}`);
  };

  const load = useCallback(async (m: string | null) => {
    try {
      const res = await fetch(`/api/leaderboard${m ? `?month=${m}` : ''}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    load(month);
    const id = setInterval(() => { if (!document.hidden) load(month); }, POLL_MS);
    return () => clearInterval(id);
  }, [month, load]);

  useEffect(() => { const id = setInterval(() => tick(t => t + 1), 30_000); return () => clearInterval(id); }, []);
  useEffect(() => { setViewState(readHash()); }, []);

  const teams = data?.teams ?? [];
  const current: View = view && (view === 'review' || teams.some(t => t.id === view)) ? view : teams[0]?.id ?? 'review';
  const team = teams.find(t => t.id === current) ?? null;
  const reviewCount = data?.review.length ?? 0;

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>Editor Leaderboard</h1>
          <p className="sub">Meta spend on ads built from each editor&apos;s briefs</p>
        </div>
        <div className="sync">
          {data?.demo && <span className="pill demo">Demo data</span>}
          {data?.lastSync && (
            <span className={`pill ${data.lastSync.ok ? '' : 'bad'}`} title={data.lastSync.error ?? ''}>
              <span className={`dot ${data.lastSync.ok ? 'ok' : 'err'}`} />
              {data.lastSync.ok ? 'Synced' : 'Sync failed'} {ago(data.lastSync.at)}
            </span>
          )}
        </div>
      </header>

      <div className="bar-row">
        <nav className="teams" role="tablist" aria-label="Team">
          {teams.map(t => (
            <button key={t.id} role="tab" aria-selected={current === t.id} className={current === t.id ? 'on' : ''} onClick={() => setView(t.id)}>
              {t.name} <span className="count">{t.editors.length}</span>
            </button>
          ))}
          <button role="tab" aria-selected={current === 'review'} className={`rv ${current === 'review' ? 'on' : ''}`} onClick={() => setView('review')}>
            Needs review {reviewCount > 0 && <span className="count warn">{reviewCount}</span>}
          </button>
        </nav>
        <nav className="months" aria-label="Month">
          {(data?.months ?? []).map(m => (
            <button key={m} className={m === data?.month ? 'on' : ''} onClick={() => setMonth(m)}>{monthLabel(m)}</button>
          ))}
        </nav>
      </div>

      {error && <div className="banner">Couldn&apos;t refresh: {error}</div>}
      {!data && !error && <div className="empty">Loading…</div>}

      {data && team && <TeamView key={`${team.id}-${data.month}`} team={team} total={data.total} />}
      {data && current === 'review' && <ReviewView data={data} />}
    </main>
  );
}

function TeamView({ team, total }: { team: TeamBoard; total: number }) {
  const [query, setQuery] = useState('');
  const [showIdle, setShowIdle] = useState(false);
  const withSpend = team.editors.filter(e => e.spend > 0);
  const idle = team.editors.filter(e => e.spend <= 0);
  const q = query.trim().toLowerCase();
  const match = (e: EditorRow) => !q || e.name.toLowerCase().includes(q) || (e.role ?? '').toLowerCase().includes(q);
  const briefs = withSpend.reduce((s, e) => s + e.briefs.length, 0);

  return (
    <>
      <section className="stats">
        <Stat label={`${team.name} team spend`} value={money(team.spend)} sub={total ? `${((team.spend / total) * 100).toFixed(1)}% of all Meta spend` : undefined} />
        <Stat label="Top editor" value={withSpend[0] ? money(withSpend[0].spend) : '—'} sub={withSpend[0]?.name ?? 'No spend yet'} />
        <Stat label="Editors with spend" value={`${withSpend.length} / ${team.editors.length}`} sub={idle.length ? `${idle.length} with no spend yet` : 'Everyone has spend'} />
        <Stat label="Briefs with spend" value={String(briefs)} sub={withSpend.length ? `avg ${money(team.spend / withSpend.length)} per editor` : undefined} />
      </section>

      {!withSpend.length && <div className="empty">No spend credited to the {team.name} team yet this month.</div>}
      {withSpend.length > 0 && !q && <Podium editors={withSpend.slice(0, 3)} />}

      <div className="list-head">
        <h2>{team.name} ranking</h2>
        <input className="search" type="search" placeholder="Search editor or role" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search editors" />
      </div>
      <Rows editors={withSpend.filter(match)} top={withSpend[0]?.spend ?? 0} />
      {q && !withSpend.some(match) && !idle.some(match) && <div className="empty small">Nobody matches “{query}”.</div>}

      {idle.length > 0 && (
        <section className="idle">
          <button className="idle-toggle" onClick={() => setShowIdle(s => !s)} aria-expanded={showIdle || !!q}>
            {showIdle || q ? '▾' : '▸'} No spend yet this month <span className="count">{idle.length}</span>
          </button>
          {(showIdle || q) && (
            <ul className="idle-list">
              {idle.filter(match).map(e => (
                <li key={e.key}><Avatar name={e.name} src={e.avatar} size={28} /><span className="name">{e.name}</span><span className="role">{e.role}</span></li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

function ReviewView({ data }: { data: LeaderboardPayload }) {
  const unattributed = Math.max(0, data.total - data.attributed);
  return (
    <>
      <section className="stats">
        <Stat label="Total Meta spend" value={money(data.total)} />
        <Stat label="Credited to editors" value={money(data.attributed)} sub={data.total ? `${Math.round((data.attributed / data.total) * 100)}% (all editors, any team)` : undefined} />
        <Stat label="Not credited" value={money(unattributed)} warn={unattributed > 0} sub={`${data.review.length} items`} />
        <Stat label="Shared briefs" value={data.splitMode === 'joint' ? 'Joint' : 'Split'} sub={data.splitMode === 'joint' ? 'credited to the pair' : 'split evenly between editors'} />
      </section>
      <Review items={data.review} />
    </>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`stat ${warn ? 'warn' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub" title={sub}>{sub}</div>}
    </div>
  );
}

function Avatar({ name, src, size = 40 }: { name: string; src: string | null; size?: number }) {
  return src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className="avatar" src={src} alt="" width={size} height={size} />
    : <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials(name)}</span>;
}

function Move({ e }: { e: EditorRow }) {
  if (e.prevRank == null) return <span className="move new">NEW</span>;
  const d = e.prevRank - e.rank;
  if (d > 0) return <span className="move up" title={`Up from #${e.prevRank}`}>▲{d}</span>;
  if (d < 0) return <span className="move down" title={`Down from #${e.prevRank}`}>▼{-d}</span>;
  return <span className="move same" title="No change">–</span>;
}

function Podium({ editors }: { editors: EditorRow[] }) {
  const order = [editors[1], editors[0], editors[2]].filter(Boolean) as EditorRow[];
  return (
    <section className="podium">
      {order.map(e => (
        <div key={e.key} className={`step p${e.rank}`}>
          <div className="medal">{e.rank}</div>
          <Avatar name={e.name} src={e.avatar} size={e.rank === 1 ? 72 : 56} />
          <div className="p-name">{e.name}</div>
          <div className="p-role">{e.role}</div>
          <div className="p-spend">{money(e.spend)}</div>
          <div className="p-meta">{e.briefs.length} briefs · {e.ads} ads · <Move e={e} /></div>
          <div className="block" />
        </div>
      ))}
    </section>
  );
}

function Rows({ editors, top }: { editors: EditorRow[]; top: number }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!editors.length) return null;
  return (
    <ol className="list">
      {editors.map(e => {
        const isOpen = open === e.key;
        return (
          <li key={e.key} className={`row ${isOpen ? 'open' : ''} ${e.rank <= 3 ? `top t${e.rank}` : ''}`}>
            <button className="row-main" onClick={() => setOpen(isOpen ? null : e.key)} aria-expanded={isOpen}>
              <span className="rank">{e.rank}</span>
              <Move e={e} />
              <Avatar name={e.name} src={e.avatar} size={36} />
              <span className="who">
                <span className="name">{e.name}</span>
                <span className="role">{e.role}</span>
              </span>
              <span className="bar"><span style={{ width: `${Math.max(2, top ? (e.spend / top) * 100 : 0)}%` }} /></span>
              <span className="meta">{e.briefs.length} briefs · {e.ads} ads</span>
              <span className="spend">{money(e.spend)}</span>
              <span className="share">{(e.share * 100).toFixed(1)}%</span>
              <span className="chev">{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && (
              <div className="scroll">
                <table className="briefs">
                  <thead><tr><th>Brief</th><th>ClickUp task</th><th className="r">Ads</th><th className="r">Spend</th></tr></thead>
                  <tbody>
                    {e.briefs.map(b => (
                      <tr key={b.briefId}>
                        <td className="mono">{b.briefId}</td>
                        <td>{b.taskUrl ? <a href={b.taskUrl} target="_blank" rel="noreferrer">{b.taskName ?? 'Open task'}</a> : b.taskName ?? '—'}</td>
                        <td className="r">{b.ads}</td>
                        <td className="r">{money(b.spend)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Review({ items }: { items: ReviewItem[] }) {
  const groups = useMemo(() => {
    const m = new Map<ReviewKind, ReviewItem[]>();
    for (const i of items) m.set(i.kind, [...(m.get(i.kind) ?? []), i]);
    return REVIEW_ORDER.filter(k => m.has(k)).map(k => ({ kind: k, items: m.get(k)!.sort((a, b) => b.spend - a.spend) }));
  }, [items]);
  const [open, setOpen] = useState<Set<ReviewKind>>(new Set());

  if (!items.length) return <div className="empty">Nothing to review. Every dollar is credited to an editor.</div>;

  return (
    <div className="review">
      {groups.map(g => {
        const sum = g.items.reduce((s, i) => s + i.spend, 0);
        const isOpen = open.has(g.kind);
        const toggle = () => setOpen(s => { const n = new Set(s); if (n.has(g.kind)) n.delete(g.kind); else n.add(g.kind); return n; });
        return (
          <section key={g.kind} className={`rgroup ${g.kind === 'name_mismatch' || g.kind === 'other_workspace' ? 'info' : ''}`}>
            <button className="rhead" onClick={toggle} aria-expanded={isOpen}>
              <h3>{isOpen ? '▾' : '▸'} {REVIEW_LABEL[g.kind].title} <span className="count">{g.items.length}</span></h3>
              <span className="rsum">{money(sum)}{g.kind === 'name_mismatch' ? ' (already credited)' : ''}</span>
            </button>
            <p className="hint">{REVIEW_LABEL[g.kind].hint}</p>
            {isOpen && (
              <div className="scroll">
                <table>
                  <thead><tr><th>Ad name</th><th>Brief</th><th>Detail</th><th className="r">Spend</th></tr></thead>
                  <tbody>
                    {g.items.slice(0, 200).map((i, n) => (
                      <tr key={`${i.adId}-${i.briefId ?? ''}-${n}`}>
                        <td className="adname">{i.adName || <em>(no name)</em>}</td>
                        <td className="mono">{i.taskUrl && i.briefId ? <a href={i.taskUrl} target="_blank" rel="noreferrer">{i.briefId}</a> : i.briefId ?? '—'}</td>
                        <td className="detail">{i.detail ?? ''}</td>
                        <td className="r">{money(i.spend)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {g.items.length > 200 && <p className="hint">Showing the 200 largest of {g.items.length}.</p>}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
