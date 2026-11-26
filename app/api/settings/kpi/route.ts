import { NextResponse } from 'next/server';
import { cfg } from '@/lib/config';
import { safeEqual } from '@/lib/auth';
import { DEFAULT_RULES, validRules } from '@/lib/kpi';
import { loadSaved, saveRules } from '@/lib/kpi-store';

export const dynamic = 'force-dynamic';

/** Saving needs SETTINGS_PASSWORD when it is set in Vercel; without it anyone with dashboard access can save */
const passwordOk = (given: unknown) => {
  const pw = process.env.SETTINGS_PASSWORD?.trim();
  return !pw || (typeof given === 'string' && safeEqual(given, pw));
};

export async function GET() {
  if (!cfg.hasDb) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
  const { saved, history } = await loadSaved();
  return NextResponse.json({
    rules: saved?.rules?.length ? saved.rules : DEFAULT_RULES, savedAt: saved?.at ?? null, defaults: DEFAULT_RULES,
    history: history.map(h => ({ at: h.at, rules: h.rules })), protected: !!process.env.SETTINGS_PASSWORD?.trim(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

/** PUT { rules, password? } saves the KPI rules (the previous version is kept in the history) */
export async function PUT(req: Request) {
  if (!cfg.hasDb) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
  const body = await req.json().catch(() => null) as { rules?: unknown; password?: unknown } | null;
  if (!passwordOk(body?.password)) return NextResponse.json({ error: 'Wrong settings password' }, { status: 403 });
  const rules = validRules(body?.rules);
  if (!rules) return NextResponse.json({ error: 'Some rules are not valid: check each row has a team, level, per week (0–100), workdays and a start date' }, { status: 400 });
  const saved = await saveRules(rules);
  return NextResponse.json({ ok: true, savedAt: saved.at });
}
