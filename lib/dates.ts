/** YYYY-MM-DD for "now" in the given IANA timezone */
export function todayIn(tz: string, d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export const monthOf = (ymd: string) => ymd.slice(0, 7);
export const monthStart = (month: string) => `${month}-01`;
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
export const isMonth = (s: string | null): s is string => !!s && /^\d{4}-\d{2}$/.test(s);
