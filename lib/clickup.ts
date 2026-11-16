/**
 * ClickUp: brief ID -> task -> Editor field.
 *
 * Confirmed against the live workspace (Nov 2026):
 * - OO-xxxx lives in a short_text custom field named "Brief ID". Custom task IDs are RS-xxxx and do
 *   NOT reliably share the number, so set CLICKUP_BRIEF_FIELD_ID to that field's ID.
 * - "Editor" is a `users` field. Tasks also have "Sr Editor" and "Strategist" users fields, so the
 *   field is matched by exact (case-insensitive) name, never substring.
 * Dropdown, labels and text Editor fields are handled too in case the field type changes.
 */
import { cfg } from './config';
import { extractBriefIds } from './briefs';
import type { BriefInfo, EditorRef } from './types';

const BASE = 'https://api.clickup.com/api/v2';
const MIN_GAP_MS = 650; // ~92 requests/min, under ClickUp's 100/min limit

export class RateLimited extends Error {}

type CuField = {
  id: string;
  name: string;
  type: string;
  value?: unknown;
  type_config?: { options?: { id: string; name?: string; label?: string; orderindex?: number | string }[] };
};
type CuTask = {
  id: string;
  name: string;
  url: string;
  date_created?: string;
  custom_fields?: CuField[];
};

let lastCall = 0;
async function cuFetch(path: string): Promise<Response> {
  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: cfg.cu.token, 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  if (res.status === 429) throw new RateLimited('ClickUp rate limit (429)');
  return res;
}

const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const nameRef = (name: string): EditorRef => ({ key: `n:${slug(name)}`, name: name.trim(), avatar: null });

/** Read the Editor field of a task, whatever its type. Returns [] when empty. */
export function extractEditors(task: CuTask, fieldName = cfg.cu.editorField): EditorRef[] {
  const field = task.custom_fields?.find(f => slug(f.name) === slug(fieldName));
  if (!field || field.value == null || field.value === '') return [];
  const v = field.value;
  const opts = field.type_config?.options ?? [];

  switch (field.type) {
    case 'users':
    case 'people': {
      const users = Array.isArray(v) ? v : [v];
      return users
        .filter((u): u is { id: number | string; username?: string; email?: string; profilePicture?: string | null } =>
          !!u && typeof u === 'object' && 'id' in u)
        .map(u => ({
          key: `u:${u.id}`,
          name: u.username || u.email || `User ${u.id}`,
          avatar: u.profilePicture ?? null,
        }));
    }
    case 'drop_down': {
      // REST returns the option's orderindex (number) or, on newer fields, its id; MCP-style shapes return {id,name}.
      if (typeof v === 'object' && v && 'name' in v) return [nameRef(String((v as { name: string }).name))];
      const opt = opts.find(o => o.id === v || String(o.orderindex) === String(v));
      return opt?.name ? [nameRef(opt.name)] : [];
    }
    case 'labels': {
      const ids = Array.isArray(v) ? v : [v];
      return ids
        .map(id => (typeof id === 'object' && id && 'label' in id ? String((id as { label: string }).label)
          : opts.find(o => o.id === id)?.label ?? opts.find(o => o.id === id)?.name))
        .filter((n): n is string => !!n)
        .map(nameRef);
    }
    default: {
      // short_text / text: "Alice", "Alice / Bob", "Alice, Bob", "Alice & Bob", "Alice and Bob"
      return String(v)
        .split(/\s*(?:[,/&+;]|\band\b)\s*/i)
        .map(s => s.trim())
        .filter(Boolean)
        .map(nameRef);
    }
  }
}

function toInfo(briefId: string, task: CuTask): BriefInfo {
  const editors = extractEditors(task);
  return {
    briefId,
    taskId: task.id,
    taskName: task.name,
    taskUrl: task.url || `https://app.clickup.com/t/${task.id}`,
    editors,
    status: editors.length ? 'ok' : 'no_editor',
  };
}

const notFound = (briefId: string): BriefInfo =>
  ({ briefId, taskId: null, taskName: null, taskUrl: null, editors: [], status: 'not_found' });

/** Find the task for one brief ID. Throws RateLimited on 429, Error on other failures. */
export async function lookupBrief(briefId: string): Promise<BriefInfo> {
  if (!cfg.cu.token || !cfg.cu.teamId) throw new Error('CLICKUP_TOKEN / CLICKUP_TEAM_ID not set');

  if (cfg.cu.briefFieldId) {
    // Brief ID stored in a custom field: filter workspace tasks by it.
    const filter = JSON.stringify([{ field_id: cfg.cu.briefFieldId, operator: '=', value: briefId }]);
    const params = new URLSearchParams({ include_closed: 'true', subtasks: 'true', custom_fields: filter });
    const res = await cuFetch(`/team/${cfg.cu.teamId}/task?${params}`);
    if (!res.ok) throw new Error(`ClickUp ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const { tasks = [] } = (await res.json()) as { tasks?: CuTask[] };
    // "=" on text can be a contains-match; keep only tasks whose field really is this brief ID.
    const exact = tasks.filter(t => {
      const f = t.custom_fields?.find(c => c.id === cfg.cu.briefFieldId);
      return typeof f?.value === 'string' && extractBriefIds(f.value).includes(briefId);
    });
    if (!exact.length) return notFound(briefId);
    // Several tasks with the same Brief ID: take the original (oldest).
    exact.sort((a, b) => Number(a.date_created ?? 0) - Number(b.date_created ?? 0));
    return toInfo(briefId, exact[0]);
  }

  // Brief ID is the ClickUp custom task ID.
  const params = new URLSearchParams({ custom_task_ids: 'true', team_id: cfg.cu.teamId });
  const res = await cuFetch(`/task/${encodeURIComponent(briefId)}?${params}`);
  if (res.status === 404) return notFound(briefId);
  if (!res.ok) {
    const body = await res.text();
    // ClickUp answers 401 with ecode ITEM_015 / OAUTH_027-style codes for unknown custom IDs
    if (/ITEM_0|not found/i.test(body)) return notFound(briefId);
    throw new Error(`ClickUp ${res.status}: ${body.slice(0, 200)}`);
  }
  return toInfo(briefId, (await res.json()) as CuTask);
}

/**
 * Look up many briefs within a time budget. Stops early on 429 or when the deadline nears.
 * Returns what it resolved plus the IDs that failed transiently.
 */
export async function lookupBriefs(briefIds: string[], deadline: number) {
  const resolved: BriefInfo[] = [];
  const failed: string[] = [];
  let rateLimited = false;
  let firstError: string | null = null;
  for (const id of briefIds) {
    if (Date.now() > deadline - 3000) break;
    try {
      resolved.push(await lookupBrief(id));
    } catch (e) {
      if (e instanceof RateLimited) { rateLimited = true; break; }
      console.error(`ClickUp lookup ${id} failed:`, e);
      firstError ??= `${id}: ${e instanceof Error ? e.message : String(e)}`;
      failed.push(id);
    }
  }
  return { resolved, failed, rateLimited, firstError, lookups: resolved.length + failed.length };
}

/** Diagnostics: which workspaces this token can see, and one sample lookup. Read-only. */
export async function clickupCheck(sampleBriefId: string): Promise<Record<string, unknown>> {
  const tokenInfo = { set: Boolean(cfg.cu.token), length: cfg.cu.token.length, startsWithPk: cfg.cu.token.startsWith('pk_'),
    hasWhitespace: /\s/.test(cfg.cu.token) };
  const teamsRes = await cuFetch('/team');
  const teamsBody = await teamsRes.json().catch(() => null) as { teams?: { id: string; name: string }[] } | null;
  const teams = teamsBody?.teams?.map(t => ({ id: t.id, name: t.name })) ?? teamsBody;
  let sample: unknown;
  try { sample = await lookupBrief(sampleBriefId); } catch (e) { sample = e instanceof Error ? e.message : String(e); }
  const probes: Record<string, string> = {
    team_tasks_nofilter: `/team/${cfg.cu.teamId}/task?page=0`,
    spaces: `/team/${cfg.cu.teamId}/space`,
    task_by_id: `/task/86d3zdu72`,
    task_by_custom_id: `/task/RS-10150?custom_task_ids=true&team_id=${cfg.cu.teamId}`,
    list_tasks: `/list/1300340000012951/task?page=0`,
    user: `/user`,
    f_fields_eq: `/team/${cfg.cu.teamId}/task?` + new URLSearchParams({ custom_fields: JSON.stringify([{ field_id: cfg.cu.briefFieldId, operator: '=', value: 'AOG-10150' }]) }),
    f_field_single: `/team/${cfg.cu.teamId}/task?` + new URLSearchParams({ custom_field: JSON.stringify({ field_id: cfg.cu.briefFieldId, operator: '=', value: 'AOG-10150' }) }),
    f_fields_notnull: `/team/${cfg.cu.teamId}/task?` + new URLSearchParams({ custom_fields: JSON.stringify([{ field_id: cfg.cu.briefFieldId, operator: 'IS NOT NULL' }]) }),
    f_list_eq: `/list/1300340000012951/task?` + new URLSearchParams({ custom_fields: JSON.stringify([{ field_id: cfg.cu.briefFieldId, operator: '=', value: 'AOG-10150' }]) }),
  };
  const probeResults: Record<string, unknown> = {};
  for (const [k, path] of Object.entries(probes)) {
    const r = await cuFetch(path);
    const t = await r.text();
    probeResults[k] = { status: r.status, body: r.ok ? `${t.length} bytes` : t.slice(0, 200) };
  }
  const rs: Record<string, unknown> = {};
  for (const id of ['OO-23150', 'OO-102515', 'OO-102845', 'CIN-101490', 'AOG-11705', 'AOG-101503']) {
    const n = id.split('-')[1];
    const r = await cuFetch(`/task/RS-${n}?custom_task_ids=true&team_id=${cfg.cu.teamId}`);
    if (!r.ok) { rs[id] = r.status; continue; }
    const t = await r.json() as CuTask;
    rs[id] = t.custom_fields?.find(c => c.id === cfg.cu.briefFieldId)?.value ?? null;
  }
  probeResults.rsBriefField = rs;
  const teamDetail = (teamsBody as { teams?: { id: string; members?: { user: { id: number; role: number } }[] }[] } | null)?.teams?.[0];
  return { token: tokenInfo, configuredTeamId: cfg.cu.teamId, teamsStatus: teamsRes.status, teams, sample, probeResults,
    memberCount: teamDetail?.members?.length };
}
