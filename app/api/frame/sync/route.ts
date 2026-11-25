import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/auth';
import { connected, durationOf } from '@/lib/frame';
import * as store from '@/lib/store';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 300;
const BUDGET_MS = 230_000;

/**
 * Looks up the video length behind each finished task's "Frame Io Link" (read-only towards Frame.io), newest
 * finished first, and stores it in frame_media. Called by the GitHub workflow after /api/tasks-sync.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await connected())) return NextResponse.json({ ok: true, skipped: 'Frame.io not connected' });
  const started = Date.now();
  const links = await store.frameLinksToCheck(400);
  let done = 0, failed = 0;
  for (const url of links) {
    if (Date.now() - started > BUDGET_MS) break;
    try {
      await store.saveFrameMedia(url, await durationOf(url));
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      await store.saveFrameMedia(url, { kind: 'error', fileId: null, seconds: null, mediaType: null, name: null, error: msg.slice(0, 300) });
      if (/not connected|token/i.test(msg)) break;
    }
    done++;
  }
  return NextResponse.json({ ok: true, checked: done, failed, ...(await store.frameStats()), ms: Date.now() - started });
}
