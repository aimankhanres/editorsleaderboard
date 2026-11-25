import { NextResponse } from 'next/server';
import { connected, frameConfigured } from '@/lib/frame';

export const dynamic = 'force-dynamic';

/** Public: whether Frame.io is set up and connected (no details) */
export async function GET() {
  const configured = frameConfigured();
  return NextResponse.json({ configured, connected: configured ? await connected().catch(() => false) : false });
}
