import { createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import { safeEqual } from '@/lib/auth';
import { cfg } from '@/lib/config';
import { markTaskStale } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * ClickUp webhook (events: taskUpdated, taskCreated, ...). Marks the task's brief stale so the next
 * sync refetches its Editor. Verifies X-Signature = hex HMAC-SHA256(raw body, CLICKUP_WEBHOOK_SECRET).
 */
export async function POST(req: Request) {
  const secret = process.env.CLICKUP_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'webhook not configured' }, { status: 404 });
  const raw = await req.text();
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  if (!safeEqual(req.headers.get('x-signature') ?? '', expected)) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }
  if (!cfg.hasDb) return NextResponse.json({ ok: true, skipped: 'no database' });

  const body = JSON.parse(raw) as { event?: string; task_id?: string };
  // Tasks we have never matched are retried by the normal EDITOR_REFRESH_HOURS cycle.
  const touched = body.task_id ? await markTaskStale(body.task_id) : 0;
  return NextResponse.json({ ok: true, touched });
}
