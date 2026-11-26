'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_RULES, ruleFor, type KpiRule } from '@/lib/kpi';
import { TEAMS } from '@/lib/teams';

type Loaded = { rules: KpiRule[]; savedAt: string | null; defaults: KpiRule[]; history: { at: string; rules: KpiRule[] }[]; protected: boolean };
const LEVELS: { id: KpiRule['tier']; label: string }[] = [
  { id: '*', label: 'Everyone' }, { id: 'editor', label: 'Editors' }, { id: 'senior', label: 'Seniors' }, { id: 'lead', label: 'Leads' },
];
const DAYS: { id: KpiRule['workdays']; label: string }[] = [{ id: 5, label: 'Mon–Fri' }, { id: 6, label: 'Mon–Sat' }, { id: 7, label: 'Every day' }];
const today = () => new Date().toISOString().slice(0, 10);
const perDay = (r: KpiRule) => Math.round((r.perWeek / r.workdays) * 100) / 100;
const when = (iso: string) => (iso === 'defaults' ? 'the built-in defaults' : new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));

/** KPI rules editor: what each team and level should finish, with a live preview of the result */
export default function Settings() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [rules, setRules] = useState<KpiRule[]>([]);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [day, setDay] = useState(today());

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/kpi', { cache: 'no-store' });
    const json = await res.json();
    if (!res.ok) { setStatus({ kind: 'err', text: json.error ?? res.statusText }); return; }
    setLoaded(json); setRules(json.rules);
  }, []);
  useEffect(() => { load(); }, [load]);

  const dirty = loaded != null && JSON.stringify(rules) !== JSON.stringify(loaded.rules);
  const set = (i: number, patch: Partial<KpiRule>) => setRules(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRules(rs => [...rs, { id: `r${Date.now().toString(36)}`, team: '*', tier: 'senior', perWeek: 10, workdays: 5, from: today(), to: null, note: '' }]);
  const remove = (i: number) => setRules(rs => rs.filter((_, j) => j !== i));
  const save = async () => {
    setSaving(true); setStatus(null);
    try {
      const res = await fetch('/api/settings/kpi', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules, password }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setStatus({ kind: 'ok', text: 'Saved. Capacity, KPI met, behind and backlog now use these rules.' });
      await load();
    } catch (e) { setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Save failed' }); }
    setSaving(false);
  };

  // Preview: the rule each team's editors, seniors and leads get on the chosen day
  const preview = useMemo(() => TEAMS.map(t => {
    const cell = (role: string) => {
      const r = ruleFor(rules, t, role, day);
      return r ? `${r.perWeek}/wk${r.perWeek ? ` · ${perDay(r)}/day` : ''}` : '—';
    };
    return { id: t.id, name: t.name, editor: cell('Editor'), senior: cell('Senior Editor'), lead: cell('Lead Editor') };
  }), [rules, day]);

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <div className="crumb">Settings</div>
          <h1>KPI rules</h1>
          <p className="sub">What each person should finish. Capacity, KPI met, behind pace, left to KPI and backlog all use these rules, for past weeks too.</p>
        </div>
      </header>

      {!loaded && !status && <div className="empty">Loading…</div>}
      {status && <div className={`banner ${status.kind === 'ok' ? 'soft' : ''}`}>{status.text}</div>}
      {loaded && (
        <>
          <p className="muted set-lead">
            For each person and day, the <strong>most specific</strong> rule wins: a level (Leads, Seniors, Editors) beats a team, and a team beats
            &quot;All teams&quot;. On a tie, a rule with an end date (like October) beats an open-ended one. Last saved {loaded.savedAt ? when(loaded.savedAt) : 'never (using defaults)'}.
          </p>
          <div className="card table-frame">
            <table className="dtable set-table">
              <thead><tr><th>Team</th><th>Level</th><th className="r">Edits / week</th><th>Workdays</th><th className="r">Per day</th><th>From</th><th>To (optional)</th><th>Note</th><th /></tr></thead>
              <tbody>
                {rules.map((r, i) => (
                  <tr key={r.id}>
                    <td><select value={r.team} onChange={e => set(i, { team: e.target.value })} aria-label="Team">
                      <option value="*">All teams</option>{TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></td>
                    <td><select value={r.tier} onChange={e => set(i, { tier: e.target.value as KpiRule['tier'] })} aria-label="Level">
                      {LEVELS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}</select></td>
                    <td className="r"><input type="number" min={0} max={100} step={0.5} value={r.perWeek} onChange={e => set(i, { perWeek: Number(e.target.value) })} aria-label="Edits per week" /></td>
                    <td><select value={r.workdays} onChange={e => set(i, { workdays: Number(e.target.value) as KpiRule['workdays'] })} aria-label="Workdays">
                      {DAYS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></td>
                    <td className="r faint">{perDay(r)}</td>
                    <td><input type="date" value={r.from} onChange={e => set(i, { from: e.target.value })} aria-label="From" /></td>
                    <td><input type="date" value={r.to ?? ''} onChange={e => set(i, { to: e.target.value || null })} aria-label="To" /></td>
                    <td><input type="text" value={r.note ?? ''} placeholder="Why" onChange={e => set(i, { note: e.target.value })} aria-label="Note" /></td>
                    <td><button className="btn-ghost small" onClick={() => remove(i)} aria-label="Delete rule">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="set-bar">
            <button className="btn-ghost" onClick={add}>+ Add rule</button>
            <button className="btn-ghost" onClick={() => setRules(DEFAULT_RULES)}>Reset to defaults</button>
            {dirty && <button className="btn-ghost" onClick={() => setRules(loaded.rules)}>Discard changes</button>}
            <span className="set-spacer" />
            {loaded.protected && <input className="search" type="password" placeholder="Settings password" value={password} onChange={e => setPassword(e.target.value)} aria-label="Settings password" />}
            <button className="rp-apply" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : dirty ? 'Save rules' : 'Saved'}</button>
          </div>
          {!loaded.protected && <p className="muted set-note">Anyone who can open the dashboard can save. To require a password, add <code>SETTINGS_PASSWORD</code> in Vercel.</p>}

          <div className="sec-h"><h2>Preview</h2><span>what each team gets on</span>
            <input type="date" value={day} onChange={e => setDay(e.target.value || today())} aria-label="Preview date" /></div>
          <div className="card table-frame">
            <table className="dtable">
              <thead><tr><th>Team</th><th>Editors</th><th>Seniors</th><th>Leads</th></tr></thead>
              <tbody>{preview.map(p => <tr key={p.id}><td><b>{p.name}</b></td><td>{p.editor}</td><td>{p.senior}</td><td>{p.lead}</td></tr>)}</tbody>
            </table>
          </div>

          {loaded.history.length > 0 && (
            <>
              <div className="sec-h"><h2>Earlier versions</h2><span>restore one, then save</span></div>
              <div className="card set-history">
                {loaded.history.slice(0, 10).map(h => (
                  <div key={h.at}><span>Version saved {when(h.at)} · {h.rules.length} rules</span>
                    <button className="btn-ghost small" onClick={() => setRules(h.rules)}>Restore</button></div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
