import { NextResponse } from 'next/server';
import { cfg } from '@/lib/config';
import { isDate, isMonth, monthOf, todayIn } from '@/lib/dates';
import { buildLeaderboard } from '@/lib/leaderboard';
import { isView } from '@/lib/channels';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const param = sp.get('month');
  const month = isMonth(param) ? param : monthOf(todayIn(cfg.timezone));
  const ch = sp.get('channel');
  const view = isView(ch) ? ch : 'meta';
  const from = sp.get('from'), to = sp.get('to');
  let range: { from: string; to: string } | null = null;
  if (from || to) {
    if (!isDate(from) || !isDate(to) || from > to) {
      return NextResponse.json({ error: 'from and to must be YYYY-MM-DD dates with from <= to' }, { status: 400 });
    }
    range = { from, to };
  }
  try {
    return NextResponse.json(await buildLeaderboard(range ? monthOf(range.to) : month, view, range, { agency: sp.get('agency') === '1' ? true : sp.get('agency') === '0' ? false : undefined }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('leaderboard failed', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
