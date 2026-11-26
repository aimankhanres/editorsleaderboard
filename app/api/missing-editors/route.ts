import { NextResponse } from 'next/server';
import { cfg } from '@/lib/config';
import { buildMissing } from '@/lib/missing';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET() {
  if (!cfg.hasDb) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
  try {
    return NextResponse.json(await buildMissing(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('missing editors failed', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
