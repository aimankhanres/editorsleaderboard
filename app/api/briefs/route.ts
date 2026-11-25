import { NextResponse } from 'next/server';
import { cfg } from '@/lib/config';
import { isDate } from '@/lib/dates';
import { buildPipeline } from '@/lib/pipeline';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

/** GET /api/briefs?from=YYYY-MM-DD&to=YYYY-MM-DD (period for "created" / "delivered"; default this month) */
export async function GET(req: Request) {
  if (!cfg.hasDb) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from'), to = sp.get('to');
  try {
    const opts = isDate(from) && isDate(to) && from <= to ? { from, to } : {};
    return NextResponse.json(await buildPipeline(opts), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('briefs failed', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
