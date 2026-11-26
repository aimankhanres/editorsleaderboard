'use client';

import { useState } from 'react';

export type Period = { month: string; range: { from: string; to: string } | null; channel: 'meta' | 'google' | 'all' };
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Month tabs and a custom date range, shared by the attribution screens (always Meta + Google together) */
export default function PeriodBar({ value, months, onChange, min, max }: {
  value: Period; months: string[]; onChange: (p: Period) => void; min?: string | null; max?: string | null;
}) {
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState(value.range?.from ?? '');
  const [to, setTo] = useState(value.range?.to ?? '');
  const shown = months.slice(0, 4);
  return (
    <div className="period-bar">
      <div className="seg" role="tablist" aria-label="Month">
        {shown.map(m => (
          <button key={m} role="tab" aria-selected={!value.range && value.month === m} className={!value.range && value.month === m ? 'on' : ''}
            onClick={() => { setCustom(false); onChange({ ...value, month: m, range: null }); }}>{monthLabel(m)}</button>
        ))}
        <button className={value.range || custom ? 'on' : ''} onClick={() => setCustom(c => !c)} aria-expanded={custom}>📅 Custom</button>
      </div>
      {custom && (
        <form className="rp-form period-custom" onSubmit={e => { e.preventDefault(); if (from && to && from <= to) onChange({ ...value, range: { from, to } }); }}>
          <label>From<input type="date" value={from} min={min ?? undefined} max={max ?? undefined} onChange={e => setFrom(e.target.value)} /></label>
          <label>To<input type="date" value={to} min={min ?? undefined} max={max ?? undefined} onChange={e => setTo(e.target.value)} /></label>
          <button type="submit" className="rp-apply" disabled={!from || !to || from > to}>Apply</button>
          {value.range && <button type="button" className="wk-today" onClick={() => { setCustom(false); onChange({ ...value, range: null }); }}>Clear</button>}
        </form>
      )}
    </div>
  );
}
