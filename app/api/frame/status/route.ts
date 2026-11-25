import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/auth';
import { q } from '@/lib/db';
import { connected, disconnect, fileIdFromUrl, frameConfigured, frameGet } from '@/lib/frame';

export const dynamic = 'force-dynamic';

/**
 * Read-only probe (cron secret): is Frame connected, which accounts it sees, and for a few recent ClickUp
 * "Frame Io Link" values, what the file record looks like (to find where video duration lives).
 * ?disconnect=1 clears the stored tokens so someone else can connect.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  if (url.searchParams.get('disconnect')) { await disconnect(); return NextResponse.json({ ok: true, disconnected: true }); }
  const links = await q<{ frame_url: string; name: string }>(
    `SELECT frame_url, name FROM cu_tasks WHERE frame_url IS NOT NULL ORDER BY COALESCE(delivered, edit_done, updated_at) DESC NULLS LAST LIMIT 8`);
  const out: Record<string, unknown> = { configured: frameConfigured(), connected: await connected(), sampleLinks: links.map(l => l.frame_url) };
  if (!out.connected) return NextResponse.json(out);
  const accounts = await frameGet<{ data?: { id: string; display_name: string }[] }>('/accounts');
  out.accounts = accounts.status === 200 ? accounts.body.data?.map(a => ({ id: a.id, name: a.display_name })) : accounts;
  const acc = accounts.body?.data?.[0]?.id;
  const probes = [];
  for (const l of links.slice(0, 4)) {
    const id = fileIdFromUrl(l.frame_url);
    if (!id || !acc) { probes.push({ link: l.frame_url, fileId: id }); continue; }
    const f = await frameGet(`/accounts/${acc}/files/${id}?include=metadata,media_links.original`);
    probes.push({ link: l.frame_url, fileId: id, status: f.status, body: f.body });
  }
  out.probes = probes;
  return NextResponse.json(out);
}
