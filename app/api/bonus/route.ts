import { NextResponse } from 'next/server';
import { cfg } from '@/lib/config';
import { buildBonus } from '@/lib/bonus';
import { buildLeaderboard } from '@/lib/leaderboard';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

/** GET /api/bonus?month=YYYY-MM : every person's scorecard for that month (percentages of base pay only) */
export async function GET(req: Request) {
  if (!cfg.hasDb) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
  try {
    const bonus = await buildBonus(new URL(req.url).searchParams.get('month'));
    // Tracked, not paid (for now): ad spend and winners from the Editors screen for the same month
    try {
      const lb = await buildLeaderboard(bonus.month, 'all');
      const by = new Map(lb.editors.map(e => [e.key, e]));
      for (const p of bonus.people) { const e = by.get(p.key); p.tracked = { spend: e?.spend ?? 0, winners: e?.winners.length ?? 0 }; }
    } catch (e) { console.error('bonus tracked', e); }
    return NextResponse.json(bonus, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('bonus failed', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
