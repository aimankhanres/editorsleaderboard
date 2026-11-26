'use client';

import { useEffect, useRef, useState } from 'react';

export type DateRange = { from: string; to: string };
type Preset = { id: string; label: string; range: () => DateRange };

// ---- date helpers (YYYY-MM-DD strings, calendar days, no time zones)
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
export const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const dow = (s: string) => (parse(s).getUTCDay() + 6) % 7; // Mon = 0
const monthStart = (s: string) => `${s.slice(0, 7)}-01`;
const monthEnd = (s: string) => { const d = parse(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return ymd(d); };
const addMonths = (s: string, n: number) => { const d = parse(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + n); return ymd(d); };
const span = (r: DateRange) => Math.round((parse(r.to).getTime() - parse(r.from).getTime()) / 864e5) + 1;
export const todayYmd = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
export const isWholeMonth = (r: DateRange) => r.from === monthStart(r.from) && r.to === monthEnd(r.from);
export const isMonWeek = (r: DateRange) => dow(r.from) === 0 && span(r) === 7;
const fmt = (s: string, year = false) => parse(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });

export function presetsFor(today = todayYmd()): Preset[] {
  const wk = addDays(today, -dow(today));
  return [
    { id: 'this-week', label: 'This week', range: () => ({ from: wk, to: addDays(wk, 6) }) },
    { id: 'last-week', label: 'Last week', range: () => ({ from: addDays(wk, -7), to: addDays(wk, -1) }) },
    { id: 'this-month', label: 'This month', range: () => ({ from: monthStart(today), to: monthEnd(today) }) },
    { id: 'last-month', label: 'Last month', range: () => ({ from: addMonths(today, -1), to: monthEnd(addMonths(today, -1)) }) },
    { id: 'last-7', label: 'Last 7 days', range: () => ({ from: addDays(today, -6), to: today }) },
    { id: 'last-14', label: 'Last 14 days', range: () => ({ from: addDays(today, -13), to: today }) },
    { id: 'last-30', label: 'Last 30 days', range: () => ({ from: addDays(today, -29), to: today }) },
    { id: 'last-90', label: 'Last 90 days', range: () => ({ from: addDays(today, -89), to: today }) },
  ];
}

/** "This week · Nov 23 – 29", "November 2026", "Nov 3 – Nov 18" */
export function rangeLabel(r: DateRange, today = todayYmd()): { name: string | null; dates: string } {
  const p = presetsFor(today).find(x => { const pr = x.range(); return pr.from === r.from && pr.to === r.to; });
  const sameYear = r.from.slice(0, 4) === r.to.slice(0, 4);
  const dates = isWholeMonth(r)
    ? parse(r.from).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : r.from === r.to ? fmt(r.from, true)
    : `${fmt(r.from, !sameYear)} – ${r.from.slice(0, 7) === r.to.slice(0, 7) ? String(Number(r.to.slice(8))) : fmt(r.to)}${sameYear && r.from.slice(0, 4) !== today.slice(0, 4) ? `, ${r.from.slice(0, 4)}` : ''}`;
  return { name: p?.label ?? null, dates };
}

/** The range one step back / forward: a month moves by a month, a Mon–Sun week by a week, anything else by its length */
export function shiftRange(r: DateRange, dir: 1 | -1): DateRange {
  if (isWholeMonth(r)) { const f = addMonths(r.from, dir); return { from: f, to: monthEnd(f) }; }
  const n = span(r) * dir;
  return { from: addDays(r.from, n), to: addDays(r.to, n) };
}

/**
 * Date range control: one button with the selected dates and ‹ › steps; it opens quick picks plus a two-month calendar
 * (click a start day, then an end day). `min` / `max` grey out days with no data.
 */
export default function DateRangePicker({ value, onChange, min, max, presets }: {
  value: DateRange; onChange: (r: DateRange) => void; min?: string | null; max?: string | null; presets?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ from: string; to: string | null }>({ from: value.from, to: value.to });
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState(monthStart(value.to)); // right-hand month shown
  const box = useRef<HTMLDivElement>(null);
  const today = todayYmd();
  const list = presetsFor(today).filter(p => !presets || presets.includes(p.id));

  useEffect(() => { if (open) { setDraft({ from: value.from, to: value.to }); setView(monthStart(value.to)); } }, [open, value.from, value.to]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const label = rangeLabel(value, today);
  const apply = (r: DateRange) => { onChange(r); setOpen(false); };
  const next = shiftRange(value, 1);
  const canNext = !max || next.from <= max;
  const pick = (d: string) => {
    if (!draft.from || draft.to) { setDraft({ from: d, to: null }); return; }
    setDraft(d < draft.from ? { from: d, to: draft.from } : { from: draft.from, to: d });
  };
  const disabled = (d: string) => (!!min && d < min) || (!!max && d > max);
  const lo = draft.to ? draft.from : hover && hover < draft.from ? hover : draft.from;
  const hi = draft.to ?? (hover && hover > draft.from ? hover : draft.from);

  const Month = ({ start }: { start: string }) => {
    const first = dow(start), days = Number(monthEnd(start).slice(8));
    const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => `${start.slice(0, 8)}${pad(i + 1)}`)];
    return (
      <div className="drp-month">
        <div className="drp-mname">{parse(start).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</div>
        <div className="drp-grid">
          {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(w => <span key={w} className="drp-w">{w}</span>)}
          {cells.map((d, i) => d ? (
            <button key={d} type="button" disabled={disabled(d)} onClick={() => pick(d)} onMouseEnter={() => setHover(d)}
              className={`drp-d ${d >= lo && d <= hi ? 'in' : ''} ${d === lo ? 'start' : ''} ${d === hi ? 'end' : ''} ${d === today ? 'today' : ''}`}>
              {Number(d.slice(8))}
            </button>
          ) : <span key={`e${i}`} />)}
        </div>
      </div>
    );
  };

  return (
    <div className="drp" ref={box}>
      <div className="drp-bar">
        <button type="button" className="drp-step" aria-label="Previous period" onClick={() => onChange(shiftRange(value, -1))}>‹</button>
        <button type="button" className={`drp-btn ${open ? 'on' : ''}`} onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="dialog">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          {label.name && <span className="drp-name">{label.name}</span>}
          <span className="drp-dates">{label.dates}</span>
          <span className="drp-caret">▾</span>
        </button>
        <button type="button" className="drp-step" aria-label="Next period" disabled={!canNext} onClick={() => onChange(next)}>›</button>
      </div>
      {open && (
        <div className="drp-pop card" role="dialog" aria-label="Choose dates">
          <div className="drp-presets">
            {list.map(p => {
              const r = p.range();
              const on = r.from === value.from && r.to === value.to;
              return <button key={p.id} type="button" className={on ? 'on' : ''} onClick={() => apply(r)}>{p.label}</button>;
            })}
          </div>
          <div className="drp-cal">
            <div className="drp-nav">
              <button type="button" aria-label="Earlier months" onClick={() => setView(v => addMonths(v, -1))}>‹</button>
              <button type="button" aria-label="Later months" onClick={() => setView(v => addMonths(v, 1))}>›</button>
            </div>
            <div className="drp-months"><Month start={addMonths(view, -1)} /><Month start={view} /></div>
            <div className="drp-foot">
              <span className="muted">{draft.to ? `${fmt(draft.from, true)} – ${fmt(draft.to, true)}` : draft.from ? `${fmt(draft.from, true)} – pick an end day` : 'Pick a start day'}</span>
              <button type="button" className="btn-ghost small" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="rp-apply" disabled={!draft.to} onClick={() => draft.to && apply({ from: draft.from, to: draft.to })}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
