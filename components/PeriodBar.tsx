'use client';

import DateRangePicker, { addDays, isWholeMonth, type DateRange } from './DateRangePicker';

export type Period = { month: string; range: { from: string; to: string } | null; channel: 'meta' | 'google' | 'all' };
const nextMonthOf = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };

/** The date control shared by the attribution screens (always Meta + Google together): a whole month or any range */
export default function PeriodBar({ value, onChange, min, max }: {
  value: Period; months?: string[]; onChange: (p: Period) => void; min?: string | null; max?: string | null;
}) {
  const shown: DateRange = value.range ?? { from: `${value.month}-01`, to: addDays(`${nextMonthOf(value.month)}-01`, -1) };
  return (
    <div className="period-row">
      <DateRangePicker value={shown} min={min} max={max}
        onChange={r => onChange(isWholeMonth(r) ? { ...value, month: r.from.slice(0, 7), range: null } : { ...value, range: r })} />
    </div>
  );
}
