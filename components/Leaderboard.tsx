'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EditorRow, LeaderboardPayload, ReviewItem, ReviewKind } from '@/lib/types';
import { ago, initials, money, monthLabel } from '@/lib/format';

const POLL_MS = 60_000;

const REVIEW_LABEL: Record<ReviewKind, { title: string; hint: string }> = {
  no_brief_id: { title: 'No brief ID in ad name', hint: 'Ad name has no OO-xxxx, so it cannot be linked to a ClickUp task.' },
  task_not_found: { title: 'Brief not found in ClickUp', hint: 'No task has this Brief ID.' },
  no_editor: { title: 'Editor field empty', hint: 'Task found, but nobody is set in its Editor field.' },
  pending: { title: 'Waiting for ClickUp lookup', hint: 'Will be resolved by an upcoming sync.' },
  name_mismatch: { title: 'Ad name mentions a different editor', hint: 'Already credited via ClickUp; check the Editor field is right.' },
};
const REVIEW_ORDER: ReviewKind[] = ['no_editor', 'task_not_found', 'no_brief_id', 'pending', 'name_mismatch'];

export default function Leaderboard() {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<LeaderboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'board' | 'review'>('board');
  const [, tick] = useState(0);

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

  // re-render the "x min ago" label
  useEffect(() => { const id = setInterval(() => tick(t => t + 1), 30_000); return () => clearInterval(id); }, []);

  const unattributed = data ? Math.max(0, data.total - data.attributed) : 0;
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

      <nav className="tabs" aria-label="Month">
        {(data?.months ?? []).map(m => (
          <button key={m} className={`tab ${m === data?.month ? 'on' : ''}`} onClick={() => setMonth(m)}>
            {monthLabel(m)}
          </button>
        ))}
      </nav>

      {error && <div className="banner">Couldn&apos;t refresh: {error}</div>}
      {!data && !error && <div className="empty">Loading…</div>}

      {data && (
        <>
          <section className="stats">
            <Stat label="Total Meta spend" value={money(data.total)} />
            <Stat label="Credited to editors" value={money(data.attributed)}
              sub={data.total ? `${Math.round((data.attributed / data.total) * 100)}%` : undefined} />
            <Stat label="Needs review" value={money(unattributed)} sub={`${reviewCount} item${reviewCount === 1 ? '' : 's'}`}
              warn={unattributed > 0} onClick={() => setView('review')} />
            <Stat label="Editors" value={String(data.editors.length)}
              sub={data.splitMode === 'joint' ? 'shared briefs credited jointly' : 'shared briefs split evenly'} />
          </section>

          <div className="seg" role="tablist">
            <button role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>Leaderboard</button>
            <button role="tab" aria-selected={view === 'review'} className={view === 'review' ? 'on' : ''} onClick={() => setView('review')}>
              Needs review {reviewCount > 0 && <span className="count">{reviewCount}</span>}
            </button>
          </div>

          {view === 'board' ? <Board editors={data.editors} /> : <Review items={data.review} />}
        </>
      )}
    </main>
  );
}

function Stat({ label, value, sub, warn, onClick }: { label: string; value: string; sub?: string; warn?: boolean; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`stat ${warn ? 'warn' : ''} ${onClick ? 'click' : ''}`} onClick={onClick}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </Tag>
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

function Gone({ e }: { e: EditorRow }) {
  return e.active ? null : <span className="gone">No longer with us</span>;
}

function Board({ editors }: { editors: EditorRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!editors.length) return <div className="empty">No spend credited to editors yet this month.</div>;
  const top = editors.slice(0, 3);
  const podium = [top[1], top[0], top[2]].filter(Boolean) as EditorRow[];

  return (
    <>
      <section className="podium">
        {podium.map(e => (
          <div key={e.key} className={`step p${e.rank}`}>
            <div className="medal">{e.rank}</div>
            <Avatar name={e.name} src={e.avatar} size={e.rank === 1 ? 72 : 56} />
            <div className="p-name">{e.name}</div>
            <Gone e={e} />
            <div className="p-spend">{money(e.spend)}</div>
            <div className="p-meta">{e.briefs.length} briefs · {e.ads} ads · <Move e={e} /></div>
            <div className="block" />
          </div>
        ))}
      </section>

      <ol className="list">
        {editors.map(e => {
          const isOpen = open === e.key;
          return (
            <li key={e.key} className={`row ${isOpen ? 'open' : ''} ${e.active ? '' : 'inactive'}`}>
              <button className="row-main" onClick={() => setOpen(isOpen ? null : e.key)} aria-expanded={isOpen}>
                <span className="rank">{e.rank}</span>
                <Move e={e} />
                <Avatar name={e.name} src={e.avatar} size={36} />
                <span className="who">
                  <span className="name">{e.name}</span>
                  <Gone e={e} />
                </span>
                <span className="bar"><span style={{ width: `${Math.max(2, (e.spend / editors[0].spend) * 100)}%` }} /></span>
                <span className="meta">{e.briefs.length} briefs · {e.ads} ads</span>
                <span className="spend">{money(e.spend)}</span>
                <span className="share">{(e.share * 100).toFixed(1)}%</span>
                <span className="chev">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && (
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
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function Review({ items }: { items: ReviewItem[] }) {
  const groups = useMemo(() => {
    const m = new Map<ReviewKind, ReviewItem[]>();
    for (const i of items) m.set(i.kind, [...(m.get(i.kind) ?? []), i]);
    return REVIEW_ORDER.filter(k => m.has(k)).map(k => ({ kind: k, items: m.get(k)! }));
  }, [items]);

  if (!items.length) return <div className="empty">Nothing to review. Every dollar is credited to an editor.</div>;

  return (
    <div className="review">
      {groups.map(g => {
        const sum = g.items.reduce((s, i) => s + i.spend, 0);
        return (
          <section key={g.kind} className={`rgroup ${g.kind === 'name_mismatch' ? 'info' : ''}`}>
            <header>
              <h3>{REVIEW_LABEL[g.kind].title} <span className="count">{g.items.length}</span></h3>
              <span className="rsum">{money(sum)}{g.kind === 'name_mismatch' ? ' (already credited)' : ''}</span>
            </header>
            <p className="hint">{REVIEW_LABEL[g.kind].hint}</p>
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
          </section>
        );
      })}
    </div>
  );
}
