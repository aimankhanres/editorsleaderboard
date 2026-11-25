import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { authorizeUrl, connected, frameConfigured } from '@/lib/frame';

export const dynamic = 'force-dynamic';

/** Starts the one-time Frame.io (Adobe) sign-in. Only works while nobody is connected yet. */
export async function GET(req: Request) {
  if (!frameConfigured()) return NextResponse.json({ error: 'FRAMEIO_CLIENT_ID / FRAMEIO_CLIENT_SECRET are not set in Vercel' }, { status: 500 });
  if (await connected()) return NextResponse.redirect(new URL('/capacity?frame=already', req.url));
  const state = randomBytes(16).toString('hex');
  const redirect = new URL('/api/frame/callback', req.url).toString();
  const res = NextResponse.redirect(authorizeUrl(redirect, state));
  res.cookies.set('frame_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/api/frame' });
  return res;
}
