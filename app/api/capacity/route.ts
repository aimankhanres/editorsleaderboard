import { NextResponse } from 'next/server';
import { cfg } from '@/lib/config';
import { isDate } from '@/lib/dates';
import { buildCapacity } from '@/lib/capacity';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

/** GET /api/capacity?week=YYYY-MM-DD (any day of the week; defaults to this week) or ?from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(req: Request) {
  if (!cfg.hasDb) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
  const sp = new URL(req.url).searchParams;
  const [w, from, to] = ['week', 'from', 'to'].map(k => sp.get(k));
  try {
    const opts = isDate(from) && isDate(to) ? { from, to } : { week: isDate(w) ? w : null };
    return NextResponse.json(await buildCapacity(opts), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('capacity failed', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
