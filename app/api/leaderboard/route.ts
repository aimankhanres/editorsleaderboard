import { NextResponse } from 'next/server';
import { cfg } from '@/lib/config';
import { isMonth, monthOf, todayIn } from '@/lib/dates';
import { buildLeaderboard } from '@/lib/leaderboard';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const param = new URL(req.url).searchParams.get('month');
  const month = isMonth(param) ? param : monthOf(todayIn(cfg.timezone));
  try {
    return NextResponse.json(await buildLeaderboard(month), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('leaderboard failed', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
