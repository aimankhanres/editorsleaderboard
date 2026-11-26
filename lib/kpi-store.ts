/** Server-side: KPI rules in effect and saving them (kv `kpi_rules`, previous versions in `kpi_history`) */
import { DEFAULT_RULES, type KpiRule } from './kpi';
import { ensureTaskTables, kvGet, kvSet } from './store';

export type SavedRules = { rules: KpiRule[]; at: string };

/** Rules in effect: what was saved on the Settings screen, else the defaults */
export async function loadRules(): Promise<KpiRule[]> {
  await ensureTaskTables();
  const saved = await kvGet<SavedRules>('kpi_rules');
  return saved?.rules?.length ? saved.rules : DEFAULT_RULES;
}

export async function loadSaved(): Promise<{ saved: SavedRules | null; history: SavedRules[] }> {
  await ensureTaskTables();
  const [saved, history] = await Promise.all([kvGet<SavedRules>('kpi_rules'), kvGet<SavedRules[]>('kpi_history')]);
  return { saved, history: history ?? [] };
}

/** Save new rules; the version they replace goes to the history (last 20) so it can be restored */
export async function saveRules(rules: KpiRule[]): Promise<SavedRules> {
  const { saved, history } = await loadSaved();
  const prev = saved ?? { rules: DEFAULT_RULES, at: 'defaults' };
  const next = { rules, at: new Date().toISOString() };
  await kvSet('kpi_history', [prev, ...history].slice(0, 20));
  await kvSet('kpi_rules', next);
  return next;
}
