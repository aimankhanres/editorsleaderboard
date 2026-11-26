'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorRow, LeaderboardPayload, ReviewItem, ReviewKind, TeamBoard } from '@/lib/types';
import type { MissingReason, MissingTask } from '@/lib/missing';
import { ago, initials, money, monthLabel } from '@/lib/format';
import { VIEWS, isView, viewLabel, type ChannelView } from '@/lib/channels';

const POLL_MS = 60_000;

const REVIEW_LABEL: Record<ReviewKind, { title: string; hint: string }> = {
  no_brief_id: { title: 'No brief ID in ad name', hint: 'Ad name has no OO-, AOG- or CIN- brief ID, so it cannot be linked to a ClickUp task.' },
  task_not_found: { title: 'Brief not found in ClickUp', hint: 'No task has this Brief ID. Usually a typo in the ad name or an empty Brief ID field.' },
  other_workspace: { title: 'Made in another ClickUp workspace', hint: '6-digit brief from a separate ClickUp workspace, and no resize task here has it as its Old Brief Id, so no editor to credit.' },
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
  const [channel, setChannelState] = useState<ChannelView>('meta');
  const setChannel = (c: ChannelView) => {
    setChannelState(c);
    try { localStorage.setItem('channel', c); } catch { /* storage unavailable */ }
  };
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [, tick] = useState(0);

  const setView = (v: View) => {
    setViewState(v);
    if (typeof window !== 'undefined') history.replaceState(null, '', `#${v}`);
  };

  const seq = useRef(0);
  const load = useCallback(async (m: string | null, ch: ChannelView, r: { from: string; to: string } | null) => {
    const mine = ++seq.current; // ignore responses that arrive after a newer request
    try {
      const qs = new URLSearchParams({ channel: ch });
      if (r) { qs.set('from', r.from); qs.set('to', r.to); } else if (m) qs.set('month', m);
      const res = await fetch(`/api/leaderboard?${qs}`, { cache: 'no-store' });
      const json = await res.json();
      if (mine !== seq.current) return;
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setData(json);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    load(month, channel, range);
    const id = setInterval(() => { if (!document.hidden) load(month, channel, range); }, POLL_MS);
    return () => clearInterval(id);
  }, [month, channel, range, load]);

  useEffect(() => { const id = setInterval(() => tick(t => t + 1), 30_000); return () => clearInterval(id); }, []);
  useEffect(() => {
    setViewState(readHash());
    try { const c = localStorage.getItem('channel'); if (isView(c)) setChannelState(c); } catch { /* storage unavailable */ }
  }, []);

  const teams = data?.teams ?? [];
  const current: View = view && (view === 'review' || teams.some(t => t.id === view)) ? view : teams[0]?.id ?? 'review';
  const team = teams.find(t => t.id === current) ?? null;
  const groups = [...new Set(teams.map(t => t.group ?? ''))];
  // The review tab keeps whichever group was last shown
  const [lastGroup, setLastGroup] = useState('');
  const group = team ? team.group ?? '' : lastGroup || groups[0] || '';
  useEffect(() => { if (team) setLastGroup(team.group ?? ''); }, [team]);
  const reviewCount = data?.review.length ?? 0;
  const label = viewLabel(data?.channel ?? channel);
  const stale = data != null && (data.channel !== channel
    || (range ? data.range?.from !== range.from || data.range?.to !== range.to : data.range != null));
  const period = data?.range ? `${fmtDate(data.range.from)} – ${fmtDate(data.range.to)}` : null;
  const pickMonth = (m: string) => { setRange(null); setCustomOpen(false); setMonth(m); };

  return (
    <main className="wrap">
      <header className="top">
        <div className="title-row">
          <div>
          <div className="crumb">Attribution</div>
          <h1>Editors</h1>
          <p className="sub">
            Ad spend on ads built from each editor&apos;s briefs · <strong>{label === 'All' ? 'Meta + Google' : label}</strong>
            {label !== 'Meta' ? ' (Google: video campaigns only)' : ''}
          </p>
          </div>
        </div>
        <div className="sync">
          {data?.demo && <span className="pill demo">Demo data</span>}
          {data?.lastSync && (
            <span className={`pill ${data.lastSync.ok ? '' : 'bad'}`} title={data.lastSync.error ?? ''}>
              <span className={`dot ${data.lastSync.ok ? 'ok' : 'err'}`} />
              {data.lastSync.ok ? 'Updated' : 'Sync failed'} {ago(data.lastSync.at)}
            </span>
          )}
        </div>
      </header>

      {groups.length > 1 && (
        <div className="groups seg small" role="tablist" aria-label="Team group">
          {groups.map(g => (
            <button key={g} role="tab" aria-selected={group === g} className={group === g ? 'on' : ''}
              onClick={() => { const first = teams.find(t => (t.group ?? '') === g); if (first) setView(first.id); }}>{g}</button>
          ))}
        </div>
      )}
      <nav className="teams" role="tablist" aria-label="Team">
        {teams.filter(t => (t.group ?? '') === group).map(t => (
          <button key={t.id} role="tab" aria-selected={current === t.id} className={current === t.id ? 'on' : ''} onClick={() => setView(t.id)}>
            {t.name} <span className="count">{t.editors.length}</span>
          </button>
        ))}
        <button role="tab" aria-selected={current === 'review'} className={current === 'review' ? 'on' : ''} onClick={() => setView('review')}>
          Needs review {reviewCount > 0 && <span className="count warn">{reviewCount}</span>}
        </button>
      </nav>

      <section className="controls">
        <div className="control">
          <span className="control-label">Channel</span>
          <div className="seg" role="tablist" aria-label="Ad channel">
            {VIEWS.map(v => (
              <button key={v.id} role="tab" aria-selected={channel === v.id} className={channel === v.id ? 'on' : ''} onClick={() => setChannel(v.id)}>{v.label}</button>
            ))}
          </div>
        </div>
        <div className="control grow">
          <span className="control-label">Period</span>
          <div className="seg" aria-label="Period">
            {(data?.months ?? []).map(m => (
              <button key={m} className={!range && m === data?.month ? 'on' : ''} onClick={() => pickMonth(m)}>{monthLabel(m)}</button>
            ))}
            <button className={range || customOpen ? 'on' : ''} onClick={() => setCustomOpen(o => !o)} aria-expanded={customOpen}>
              {range ? `${fmtDate(range.from)} – ${fmtDate(range.to)}` : 'Custom dates'}
            </button>
          </div>
        </div>
      </section>

      {customOpen && (
        <RangePicker
          initial={range ?? data?.range ?? null}
          min={data?.dataFrom ?? undefined}
          max={data?.dataTo ?? undefined}
          onApply={r => { setRange(r); setCustomOpen(false); }}
          onClear={() => { setRange(null); setCustomOpen(false); }}
          active={range != null}
        />
      )}
      {period && <div className="period">Showing <strong>{period}</strong> · rank changes are hidden for custom dates</div>}

      {error && <div className="banner">Couldn&apos;t refresh: {error}</div>}
      {!data && !error && <div className="empty">Loading…</div>}

      <div className={stale ? 'loading' : ''}>
        {data && team && (
          <TeamView key={`${team.id}-${data.month}-${data.channel}-${data.range?.from ?? ''}-${data.range?.to ?? ''}`}
            team={team} total={data.total} label={label} custom={data.range != null} winnerSpend={data.winnerSpend} />
        )}
        {data && current === 'review' && <ReviewView data={data} label={label} />}
      </div>
    </main>
  );
}

function TeamView({ team, total, label, custom, winnerSpend }: {
  team: TeamBoard; total: number; label: string; custom: boolean; winnerSpend: number;
}) {
  const when = custom ? 'in this period' : 'this month';
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'spend' | 'winners'>('spend');
  const [showIdle, setShowIdle] = useState(false);
  const withSpend = team.editors.filter(e => e.spend > 0);
  const idle = team.editors.filter(e => e.spend <= 0);
  const q = query.trim().toLowerCase();
  const match = (e: EditorRow) => !q || e.name.toLowerCase().includes(q) || (e.role ?? '').toLowerCase().includes(q);
  const editorsWithWinners = withSpend.filter(e => e.winners.length).length;
  const sorted = sort === 'spend' ? withSpend
    : [...withSpend].sort((a, b) => b.winners.length - a.winners.length || b.spend - a.spend);
  const threshold = winnerSpend >= 1000 && winnerSpend % 1000 === 0 ? `$${winnerSpend / 1000}K` : money(winnerSpend);

  return (
    <>
      <section className="stats">
        <Stat label={`${team.name} team spend`} value={money(team.spend)}
          sub={total ? `${((team.spend / total) * 100).toFixed(1)}% of all ${label === 'All' ? '' : `${label} `}spend` : undefined} />
        <Stat label={`Winner ads (${threshold}+)`} value={String(team.winners)} highlight
          sub={team.winners ? `from ${editorsWithWinners} editor${editorsWithWinners === 1 ? '' : 's'}` : `none ${when} yet`} />
        <Stat label="Editors with spend" value={`${withSpend.length} of ${team.editors.length}`}
          sub={idle.length ? `${idle.length} with no spend ${when}` : 'Everyone has spend'} />
        <Stat label="Top editor" value={withSpend[0]?.name ?? '—'} sub={withSpend[0] ? money(withSpend[0].spend) : undefined} small />
      </section>

      {!withSpend.length && <div className="empty">No spend credited to the {team.name} team {when}.</div>}
      {withSpend.length > 0 && !q && <Podium editors={withSpend.slice(0, 3)} moves={!custom} />}

      {withSpend.length > 0 && (
        <section className="card table-card">
          <div className="table-tools">
            <h2>{team.name} ranking</h2>
            <div className="tools-right">
              <div className="seg small" aria-label="Sort by">
                <button className={sort === 'spend' ? 'on' : ''} onClick={() => setSort('spend')}>Sort by spend</button>
                <button className={sort === 'winners' ? 'on' : ''} onClick={() => setSort('winners')}>Sort by winners</button>
              </div>
              <input className="search" type="search" placeholder="Search editor or role" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search editors" />
            </div>
          </div>
          <Rows editors={sorted.filter(match)} top={withSpend[0]?.spend ?? 0} moves={!custom && sort === 'spend'} threshold={threshold} team={team.name} />
          {q && !withSpend.some(match) && <div className="empty small">Nobody with spend matches “{query}”.</div>}
        </section>
      )}

      {idle.length > 0 && (
        <section className="idle">
          <button className="idle-toggle" onClick={() => setShowIdle(s => !s)} aria-expanded={showIdle || !!q}>
            {showIdle || q ? '▾' : '▸'} No spend {when} <span className="count">{idle.length}</span>
          </button>
          {(showIdle || q) && (
            <ul className="idle-list">
              {idle.filter(match).map(e => (
                <li key={e.key} className={e.inClickUp === false ? 'not-cu' : ''}>
                  <Avatar name={e.name} src={e.avatar} size={30} /><span className="name">{e.name}</span>
                  <span className="role">{e.inClickUp === false ? 'Not in Resilia ClickUp · agency workspace' : e.role}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

function ReviewView({ data, label }: { data: LeaderboardPayload; label: string }) {
  const unattributed = Math.max(0, data.total - data.attributed);
  return (
    <>
      <section className="stats">
        <Stat label={label === 'All' ? 'Total spend (Meta + Google)' : `Total ${label} spend`} value={money(data.total)} />
        <Stat label="Credited to editors" value={money(data.attributed)} sub={data.total ? `${Math.round((data.attributed / data.total) * 100)}% (all editors, any team)` : undefined} />
        <Stat label="Not credited" value={money(unattributed)} warn={unattributed > 0} sub={`${data.review.length} items`} />
        <Stat label="Shared briefs" value={data.splitMode === 'joint' ? 'Joint' : 'Split'} sub={data.splitMode === 'joint' ? 'credited to the pair' : 'split evenly between editors'} />
      </section>
      <Review items={data.review} />
      <MissingEditorsGroup />
    </>
  );
}

function Stat({ label, value, sub, warn, highlight, small }: { label: string; value: string; sub?: string; warn?: boolean; highlight?: boolean; small?: boolean }) {
  return (
    <div className={`stat ${warn ? 'warn' : ''} ${highlight ? 'highlight' : ''}`}>
      <div className="stat-label">{highlight && <Trophy />}{label}</div>
      <div className={`stat-value ${small ? 'small' : ''}`} title={value}>{value}</div>
      {sub && <div className="stat-sub" title={sub}>{sub}</div>}
    </div>
  );
}

function Trophy({ size = 14 }: { size?: number }) {
  return (
    <svg className="trophy" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />
    </svg>
  );
}

function WinnerBadge({ n, threshold }: { n: number; threshold: string }) {
  if (!n) return <span className="winners none" title={`No ads with ${threshold}+ spend`}>0</span>;
  return <span className="winners" title={`${n} ad${n === 1 ? '' : 's'} with ${threshold}+ spend`}><Trophy size={13} />{n}</span>;
}

function Avatar({ name, src, size = 40, tier }: { name: string; src: string | null; size?: number; tier?: EditorRow['tier'] }) {
  const cls = `avatar ${tier ? `tier-${tier}` : ''}`;
  return src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className={cls} src={src} alt="" width={size} height={size} />
    : <span className={cls} style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials(name)}</span>;
}

const TIER_LABEL = { lead: 'Lead', senior: 'Senior', editor: 'Editor' } as const;
/** Tier badge + the org-chart role, plus the other teams for people on several boards */
function RoleLine({ e, team }: { e: EditorRow; team?: string }) {
  const others = (e.boards ?? []).filter(b => b.name !== team);
  return (
    <span className="role">
      {e.tier && <span className={`tier-badge ${e.tier}`}>{TIER_LABEL[e.tier]}</span>}
      {others.length > 0 && <span className="board-chip" title="Works on several boards: this row shows only spend from this team's ClickUp board">+{others.map(b => b.name).join(', ')}</span>}
      {e.inClickUp === false ? 'Not in Resilia ClickUp · agency workspace' : e.role}
    </span>
  );
}

function Move({ e }: { e: EditorRow }) {
  if (e.prevRank == null) return <span className="move new">NEW</span>;
  const d = e.prevRank - e.rank;
  if (d > 0) return <span className="move up" title={`Up from #${e.prevRank}`}>▲ {d}</span>;
  if (d < 0) return <span className="move down" title={`Down from #${e.prevRank}`}>▼ {-d}</span>;
  return <span className="move same" title="No change">–</span>;
}

function Podium({ editors, moves }: { editors: EditorRow[]; moves: boolean }) {
  const order = [editors[1], editors[0], editors[2]].filter(Boolean) as EditorRow[];
  return (
    <section className="podium">
      {order.map(e => (
        <div key={e.key} className={`step p${e.rank}`}>
          <div className="medal">{e.rank}</div>
          <Avatar name={e.name} src={e.avatar} size={e.rank === 1 ? 68 : 56} tier={e.tier} />
          <div className="p-name">{e.name}</div>
          <div className="p-role">{e.tier && <span className={`tier-badge ${e.tier}`}>{TIER_LABEL[e.tier]}</span>} {e.role}</div>
          <div className="p-spend">{money(e.spend)}</div>
          <div className="p-meta">
            {e.winners.length > 0 && <span className="winners"><Trophy size={13} />{e.winners.length} winner{e.winners.length === 1 ? '' : 's'}</span>}
            <span>{e.briefs.length} briefs · {e.ads} ads</span>
            {moves && <Move e={e} />}
          </div>
        </div>
      ))}
    </section>
  );
}

function Rows({ editors, top, moves, threshold, team }: { editors: EditorRow[]; top: number; moves: boolean; threshold: string; team?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!editors.length) return null;
  return (
    <div className="table" role="table" aria-label="Ranking">
      <div className="thead" role="row">
        <span className="c-rank">#</span>
        <span className="c-editor">Editor</span>
        <span className="c-win" title={`Ads with ${threshold}+ spend`}>Winners</span>
        <span className="c-num c-opt">Briefs</span>
        <span className="c-num c-opt">Ads</span>
        <span className="c-num" title="Videos finished in the period (ClickUp Edit Complete / Asset Delivered date)">Videos</span>
        <span className="c-num" title="Statics finished in the period (ClickUp Size: Static 4x5)">Statics</span>
        <span className="c-num" title="Minutes of finished video in the period (Frame.io durations)">Min</span>
        <span className="c-spend">Spend</span>
        <span className="c-share">Share of team</span>
        <span />
      </div>
      {editors.map((e, i) => {
        const isOpen = open === e.key;
        return (
          <div key={e.key} className={`trow ${isOpen ? 'open' : ''} ${e.rank <= 3 ? `t${e.rank}` : ''}`} role="row">
            <button className="row-main" onClick={() => setOpen(isOpen ? null : e.key)} aria-expanded={isOpen}>
              <span className="c-rank"><b>{moves ? e.rank : i + 1}</b>{moves && <Move e={e} />}</span>
              <span className="c-editor">
                <Avatar name={e.name} src={e.avatar} size={34} tier={e.tier} />
                <span className="who"><span className="name">{e.name}</span><RoleLine e={e} team={team} /></span>
              </span>
              <span className="c-win"><WinnerBadge n={e.winners.length} threshold={threshold} /></span>
              <span className="c-num c-opt">{e.briefs.length}</span>
              <span className="c-num c-opt">{e.ads}</span>
              <span className="c-num">{e.videos ?? '—'}</span>
              <span className="c-num">{e.statics ?? '—'}</span>
              <span className="c-num" title="Minutes of finished video (Frame.io)">{e.minutes ? Math.round(e.minutes) : e.inClickUp === false ? '—' : 0}</span>
              <span className="c-spend">{money(e.spend)}</span>
              <span className="c-share">
                <span className="bar"><span style={{ width: `${Math.max(2, top ? (e.spend / top) * 100 : 0)}%` }} /></span>
                <span className="pct">{(e.share * 100).toFixed(1)}%</span>
              </span>
              <span className="chev">{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && (
              <div className="detail-panel">
                {e.boards && e.boards.length > 1 && (
                  <div className="detail-block">
                    <h4>Spend by board (task origin)</h4>
                    <div className="board-split">
                      {e.boards.map(b => {
                        const all = e.boards!.reduce((a, x) => a + x.spend, 0);
                        return (
                          <div key={b.team} className={`bs-item ${b.name === team ? 'cur' : ''}`}>
                            <div className="bs-h"><span>{b.name}</span><b>{money(b.spend)}</b></div>
                            <div className="bs-bar"><span style={{ width: `${all ? (b.spend / all) * 100 : 0}%` }} /></div>
                            <div className="bs-n">{b.ads} ads · {all ? Math.round((b.spend / all) * 100) : 0}% of their spend</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="detail-block">
                  <h4><Trophy size={14} /> Winner ads ({threshold}+)</h4>
                  {e.winners.length ? (
                    <ul className="winner-list">
                      {e.winners.map(w => (
                        <li key={w.adId}>
                          <span className="w-spend">{money(w.spend)}</span>
                          <span className="w-name">{w.adName}</span>
                          <span className="w-meta">{w.taskUrl ? <a className="mono" href={w.taskUrl} target="_blank" rel="noreferrer">{w.briefId}</a> : <span className="mono">{w.briefId}</span>}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="muted">No ad reached {threshold} in this period.</p>}
                </div>
                <div className="detail-block">
                  <h4>All briefs ({e.briefs.length})</h4>
                  <div className="scroll">
                    <table className="briefs">
                      <thead><tr><th>Brief</th><th>ClickUp task</th><th className="r">Ads</th><th className="r">Credited spend</th></tr></thead>
                      <tbody>
                        {e.briefs.map(b => (
                          <tr key={b.briefId} className={e.winners.some(w => w.briefId === b.briefId) ? 'win' : ''}>
                            <td className="mono nowrap">{e.winners.some(w => w.briefId === b.briefId) && <Trophy size={12} />} {b.briefId}</td>
                            <td>{b.taskUrl ? <a href={b.taskUrl} target="_blank" rel="noreferrer">{b.taskName ?? 'Open task'}</a> : b.taskName ?? '—'}</td>
                            <td className="r">{b.ads}</td>
                            <td className="r">{money(b.spend)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
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
            <div className="rbar">
              <p className="hint">{REVIEW_LABEL[g.kind].hint}</p>
              <button className="btn-ghost small" onClick={() => downloadCsv(g.kind, g.items)}>
                ⬇ Download CSV{g.kind === 'no_editor' ? ` (${new Set(g.items.map(i => i.taskUrl ?? i.briefId)).size} tasks)` : ''}
              </button>
            </div>
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

const csvCell = (v: string | number | null | undefined) => {
  const t = v == null ? '' : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/**
 * CSV of one Needs-review group. "Editor field empty" is one row per ClickUp task (what someone has to open and fix),
 * biggest spend first; every other group is one row per ad, like the table.
 */
function downloadCsv(kind: ReviewKind, items: ReviewItem[]) {
  let rows: (string | number | null | undefined)[][];
  if (kind === 'no_editor') {
    const byTask = new Map<string, { name: string; url: string; briefs: Set<string>; ads: Set<string>; spend: number; ad: string; adSpend: number }>();
    for (const i of items) {
      const k = i.taskUrl ?? i.briefId ?? i.adId;
      const t = byTask.get(k) ?? { name: (i.detail ?? '').replace(/^Via resize:\s*/, ''), url: i.taskUrl ?? '', briefs: new Set(), ads: new Set(), spend: 0, ad: '', adSpend: -1 };
      if (i.briefId) t.briefs.add(i.briefId);
      t.ads.add(i.adId);
      t.spend += i.spend;
      if (i.spend > t.adSpend) { t.ad = i.adName; t.adSpend = i.spend; }
      byTask.set(k, t);
    }
    rows = [['Task name', 'Task link', 'Brief ID', 'Ads', 'Spend (USD)', 'Biggest ad'],
      ...[...byTask.values()].sort((a, b) => b.spend - a.spend).map(t => [t.name, t.url, [...t.briefs].join(' '), t.ads.size, t.spend.toFixed(2), t.ad])];
  } else {
    rows = [['Ad name', 'Brief ID', 'Task link', 'Detail', 'Spend (USD)'],
      ...[...items].sort((a, b) => b.spend - a.spend).map(i => [i.adName, i.briefId, i.taskUrl, i.detail, i.spend.toFixed(2)])];
  }
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `needs-review-${kind.replace(/_/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const MISSING_REASON: Record<MissingReason, string> = { spend: 'Has ad spend', finished: 'Edit finished', in_progress: 'In progress' };

/**
 * Needs review group: tasks on Resilia's live ClickUp boards that should have an Editor but don't (has ad spend, edit
 * finished, or past the brief stage). Independent of the selected month: it's the current state of ClickUp.
 */
function MissingEditorsGroup() {
  const [data, setData] = useState<{ tasks: MissingTask[]; month: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState<'all' | MissingReason>('all');
  useEffect(() => {
    fetch('/api/missing-editors', { cache: 'no-store' }).then(r => r.json()).then(j => (j.error ? setError(j.error) : setData(j))).catch(e => setError(String(e)));
  }, []);
  if (error) return <section className="rgroup"><p className="hint">Couldn&apos;t load tasks missing an editor: {error}</p></section>;
  if (!data) return null;
  const rows = data.tasks.filter(t => why === 'all' || t.reasons.includes(why));
  const count = (r: MissingReason) => data.tasks.filter(t => t.reasons.includes(r)).length;
  const download = () => {
    const lines = [['Task name', 'Task link', 'Board', 'Status', 'Brief ID', 'Why listed', 'Ad spend all time (USD)', `Ad spend ${data.month} (USD)`, 'Edit finished', 'Created'],
      ...rows.map(t => [t.name, t.url, t.board, t.status, t.briefId, t.reasons.map(r => MISSING_REASON[r]).join(' + '), t.spend.toFixed(2), t.spendMonth.toFixed(2), t.finished, t.created])];
    const url = URL.createObjectURL(new Blob(['\ufeff' + lines.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `tasks-missing-editor-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="rgroup">
      <button className="rhead" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <h3>{open ? '▾' : '▸'} Tasks missing an editor <span className="count">{data.tasks.length}</span></h3>
        <span className="rsum">{money(data.tasks.reduce((a, t) => a + t.spend, 0))} all-time spend</span>
      </button>
      <div className="rbar">
        <p className="hint">ClickUp tasks on live boards with an empty Editor field that should have one: they have ad spend, a finished edit, or are past the brief stage. Set the Editor in ClickUp and they drop off after the next sync.</p>
        <button className="btn-ghost small" onClick={download}>⬇ Download CSV ({rows.length} tasks)</button>
      </div>
      {open && (
        <>
          <div className="seg small" role="tablist" aria-label="Why listed" style={{ margin: '4px 0 10px' }}>
            {(['all', 'spend', 'finished', 'in_progress'] as const).map(k => (
              <button key={k} role="tab" aria-selected={why === k} className={why === k ? 'on' : ''} onClick={() => setWhy(k)}>
                {k === 'all' ? `All ${data.tasks.length}` : `${MISSING_REASON[k]} ${count(k)}`}
              </button>
            ))}
          </div>
          <div className="scroll">
            <table>
              <thead><tr><th>ClickUp task</th><th>Board</th><th>Status</th><th>Brief</th><th>Why</th><th className="r">Ad spend</th></tr></thead>
              <tbody>
                {rows.slice(0, 300).map(t => (
                  <tr key={t.taskId}>
                    <td className="adname"><a href={t.url} target="_blank" rel="noreferrer">{t.name}</a></td>
                    <td className="detail">{t.board}</td>
                    <td className="detail">{t.status ?? '—'}</td>
                    <td className="mono">{t.briefId ?? '—'}</td>
                    <td className="detail">{t.reasons.map(r => MISSING_REASON[r]).join(', ')}</td>
                    <td className="r">{t.spend ? money(t.spend) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 300 && <p className="hint">Showing 300 of {rows.length}; the CSV has all of them.</p>}
          </div>
        </>
      )}
    </section>
  );
}

const fmtDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function RangePicker({ initial, min, max, onApply, onClear, active }: {
  initial: { from: string; to: string } | null; min?: string; max?: string; active: boolean;
  onApply: (r: { from: string; to: string }) => void; onClear: () => void;
}) {
  const last = max ?? new Date().toISOString().slice(0, 10);
  const shift = (ymd: string, n: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const clamp = (ymd: string) => (min && ymd < min ? min : ymd);
  const [from, setFrom] = useState(initial?.from ?? clamp(shift(last, -6)));
  const [to, setTo] = useState(initial?.to ?? last);
  const valid = !!from && !!to && from <= to;
  const presets: { label: string; from: string; to: string }[] = [
    { label: 'Today', from: last, to: last },
    { label: 'Yesterday', from: shift(last, -1), to: shift(last, -1) },
    { label: 'Last 7 days', from: clamp(shift(last, -6)), to: last },
    { label: 'Last 14 days', from: clamp(shift(last, -13)), to: last },
  ];
  return (
    <section className="range" aria-label="Custom date range">
      <div className="range-fields">
        <label>From<input type="date" value={from} min={min} max={to || max} onChange={e => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} min={from || min} max={max} onChange={e => setTo(e.target.value)} /></label>
        <button className="apply" disabled={!valid} onClick={() => valid && onApply({ from, to })}>Apply</button>
        {active && <button className="ghost" onClick={onClear}>Back to month</button>}
      </div>
      <div className="presets">
        {presets.map(p => (
          <button key={p.label} onClick={() => { setFrom(p.from); setTo(p.to); onApply({ from: p.from, to: p.to }); }}>{p.label}</button>
        ))}
      </div>
      {min && <p className="hint">Data available from {fmtDate(min)}{max ? ` to ${fmtDate(max)}` : ''}.</p>}
    </section>
  );
}
