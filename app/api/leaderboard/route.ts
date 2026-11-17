import { NextResponse } from 'next/server';
import { cfg } from '@/lib/config';
import { isMonth, monthOf, todayIn } from '@/lib/dates';
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
  try {
    return NextResponse.json(await buildLeaderboard(month, view), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('leaderboard failed', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
