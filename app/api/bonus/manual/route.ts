import { NextResponse } from 'next/server';
import { cfg } from '@/lib/config';
import { safeEqual } from '@/lib/auth';
import { ensureTaskTables, kvGet, kvSet } from '@/lib/store';

export const dynamic = 'force-dynamic';
const LINES = new Set(['blockers', 'recurring_blockers']);

/** PUT { month, key, line, value (0–100 or null), password? } : a hand-scored scorecard line (SETTINGS_PASSWORD if set) */
export async function PUT(req: Request) {
  if (!cfg.hasDb) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
  const b = await req.json().catch(() => null) as { month?: string; key?: string; line?: string; value?: number | null; password?: string } | null;
  const pw = process.env.SETTINGS_PASSWORD?.trim();
  if (pw && !(typeof b?.password === 'string' && safeEqual(b.password, pw))) return NextResponse.json({ error: 'Wrong settings password' }, { status: 403 });
  if (!b || !/^\d{4}-\d{2}$/.test(b.month ?? '') || !b.key || !LINES.has(b.line ?? '') || !(b.value == null || (b.value >= 0 && b.value <= 100))) {
    return NextResponse.json({ error: 'Send month, key, line and a value from 0 to 100' }, { status: 400 });
  }
  await ensureTaskTables();
  const all = (await kvGet<Record<string, Record<string, Record<string, number>>>>('bonus_manual')) ?? {};
  const month = (all[b.month!] ??= {});
  const person = (month[b.key] ??= {});
  if (b.value == null) delete person[b.line!]; else person[b.line!] = Math.round(b.value);
  await kvSet('bonus_manual', all);
  return NextResponse.json({ ok: true });
}
