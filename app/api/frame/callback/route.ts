import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { connected, exchangeCode } from '@/lib/frame';

export const dynamic = 'force-dynamic';

/** Adobe redirects here after sign-in: swap the code for tokens (kept server-side only). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const back = (q: string) => NextResponse.redirect(new URL(`/capacity?frame=${q}`, req.url));
  if (url.searchParams.get('error')) return back(`error-${encodeURIComponent(url.searchParams.get('error') ?? '')}`);
  if (!code || !state || cookies().get('frame_state')?.value !== state) return back('bad-state');
  if (await connected()) return back('already');
  try {
    await exchangeCode(code);
    return back('connected');
  } catch (e) {
    console.error('frame callback', e);
    return back('token-failed');
  }
}
