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
import { BARE_PREFIX, extractBriefIds, isBareNumber, isOtherWorkspaceBrief } from './briefs';
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

/** Workspace tasks whose short_text field `fieldId` holds exactly this brief ID, oldest first. */
async function tasksWithField(fieldId: string, briefId: string): Promise<CuTask[]> {
  const filter = JSON.stringify([{ field_id: fieldId, operator: '=', value: briefId }]);
  const params = new URLSearchParams({ include_closed: 'true', subtasks: 'true', custom_fields: filter });
  const res = await cuFetch(`/team/${cfg.cu.teamId}/task?${params}`);
  if (!res.ok) throw new Error(`ClickUp ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { tasks = [] } = (await res.json()) as { tasks?: CuTask[] };
  // "=" on text can be a contains-match; keep only tasks whose field really is this brief ID.
  return tasks
    .filter(t => {
      const f = t.custom_fields?.find(c => c.id === fieldId);
      return typeof f?.value === 'string' && extractBriefIds(f.value).includes(briefId);
    })
    .sort((a, b) => Number(a.date_created ?? 0) - Number(b.date_created ?? 0));
}

/** True when a task name references `briefId` as a resize source: "rAOG-100721", "rAOG_100721", "r AOG 100721". */
export function isResizeOf(taskName: string, briefId: string): boolean {
  const [prefix, digits] = briefId.split('-');
  return new RegExp(`(?:^|[^A-Za-z0-9])r\\s?${prefix}[-_ ]?${digits}(?![0-9])`, 'i').test(taskName);
}

const PREFIXES = ['OO', 'AOG', 'CIN'];

/**
 * A bare number from an ad name ("#23755"): try it as OO-, AOG- and CIN-. Credited only when exactly one
 * prefix finds a task; if several do, it stays in Needs review listing the candidates.
 */
async function lookupBareNumber(key: string): Promise<BriefInfo> {
  const digits = key.slice(BARE_PREFIX.length);
  const hits: BriefInfo[] = [];
  for (const p of PREFIXES) {
    const info = await lookupBrief(`${p}-${digits}`);
    if (info.status !== 'not_found') hits.push(info);
  }
  if (hits.length === 1) {
    const h = hits[0];
    return { ...h, briefId: key, taskName: `${h.briefId} (number only in ad name): ${h.taskName ?? ''}` };
  }
  if (hits.length > 1) {
    return { ...notFound(key), taskName: `Number matches several briefs: ${hits.map(h => h.briefId).join(', ')}` };
  }
  return notFound(key);
}

/** Find the task for one brief ID. Throws RateLimited on 429, Error on other failures. */
export async function lookupBrief(briefId: string): Promise<BriefInfo> {
  if (!cfg.cu.token || !cfg.cu.teamId) throw new Error('CLICKUP_TOKEN / CLICKUP_TEAM_ID not set');
  if (isBareNumber(briefId)) return lookupBareNumber(briefId);

  if (cfg.cu.briefFieldId) {
    // Brief ID stored in a custom field: filter workspace tasks by it.
    const exact = await tasksWithField(cfg.cu.briefFieldId, briefId);
    if (exact.length) return toInfo(briefId, exact[0]); // several tasks with the same Brief ID: the original (oldest)

    // 6-digit briefs are made in another workspace. Credit the editor(s) of the resize tasks in this
    // workspace that were made from it, split evenly if there are several. "Old Brief Id" = this brief is
    // also set on iterations (AOG-28788 ...), which have their own brief and ads, so only tasks whose name
    // carries the resize reference "r<brief>" (16x9_AOG-26331_rAOG-100721_...) count.
    if (isOtherWorkspaceBrief(briefId) && cfg.cu.oldBriefFieldId) {
      const resizes = (await tasksWithField(cfg.cu.oldBriefFieldId, briefId)).filter(t => isResizeOf(t.name, briefId));
      if (resizes.length) {
        const editors = new Map<string, EditorRef>();
        for (const t of resizes) for (const e of extractEditors(t)) editors.set(e.key, e);
        const first = resizes[0];
        return {
          briefId,
          taskId: first.id,
          taskName: `Via resize: ${first.name}${resizes.length > 1 ? ` (+${resizes.length - 1} more)` : ''}`,
          taskUrl: first.url || `https://app.clickup.com/t/${first.id}`,
          editors: [...editors.values()],
          status: editors.size ? 'ok' : 'no_editor',
        };
      }
    }
    return notFound(briefId);
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
  const token = { set: Boolean(cfg.cu.token), startsWithPk: cfg.cu.token.startsWith('pk_'), hasWhitespace: /\s/.test(cfg.cu.token) };
  const teamsRes = await cuFetch('/team');
  const teamsBody = await teamsRes.json().catch(() => null) as { teams?: { id: string; name: string }[] } | null;
  let sample: unknown;
  try { sample = await lookupBrief(sampleBriefId); } catch (e) { sample = e instanceof Error ? e.message : String(e); }
  return {
    token, teamId: cfg.cu.teamId, briefFieldId: cfg.cu.briefFieldId,
    teams: teamsBody?.teams?.map(t => ({ id: t.id, name: t.name })) ?? teamsRes.status, sample,
  };
}

const EDITOR_FIELD_ID = process.env.CLICKUP_EDITOR_FIELD_ID || 'b2859b96-5304-464c-8e14-f2fb9e6876a5';

/**
 * Audit helper (read-only): every task whose Editor field includes this ClickUp user, and the brief IDs
 * those tasks prove the user edited: the task's own Brief ID, plus the Old Brief Id when the task is a
 * resize of it (name carries "r<brief>"). This is the reverse of lookupBrief, so it checks it independently.
 */
export async function briefsEditedBy(userId: number): Promise<{ tasks: number; briefs: Map<string, string> }> {
  const filter = JSON.stringify([{ field_id: EDITOR_FIELD_ID, operator: 'ANY', value: [userId] }]);
  const briefs = new Map<string, string>(); // briefId -> task url
  let tasks = 0;
  for (let page = 0; page < 30; page++) {
    const params = new URLSearchParams({ include_closed: 'true', subtasks: 'true', archived: 'false', page: String(page), custom_fields: filter });
    const res = await cuFetch(`/team/${cfg.cu.teamId}/task?${params}`);
    if (!res.ok) throw new Error(`ClickUp ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { tasks?: CuTask[]; last_page?: boolean };
    for (const t of body.tasks ?? []) {
      if (!extractEditors(t).some(e => e.key === `u:${userId}`)) continue; // filter sanity check
      tasks++;
      const url = t.url || `https://app.clickup.com/t/${t.id}`;
      const own = t.custom_fields?.find(f => f.id === cfg.cu.briefFieldId)?.value;
      if (typeof own === 'string') for (const b of extractBriefIds(own)) briefs.set(b, url);
      const old = t.custom_fields?.find(f => f.id === cfg.cu.oldBriefFieldId)?.value;
      if (typeof old === 'string') for (const b of extractBriefIds(old)) if (isResizeOf(t.name, b)) briefs.set(b, url);
    }
    if (body.last_page !== false || !(body.tasks ?? []).length) break;
  }
  return { tasks, briefs };
}

// ------------------------------------------------------------------ task mirror (capacity + #N matching)

/** Date fields read from every task (ms since epoch, as strings in the API) */
const F_EDIT_COMPLETE = 'e022405a-973d-41c9-bd6d-af5bfed99d68'; // "Edit Complete Date": editor finished
const F_DELIVERED = '8319778d-0b8e-4406-8db2-79075b773b85'; // "Asset Delivered Date"
const F_ASSIGNED = '0a93bbd8-98df-4ed6-90ce-7c9cb995b42d'; // "Editor Assigned Date"

export type MirroredTask = {
  taskId: string; name: string; url: string; listId: string | null; listName: string | null;
  status: string | null; statusType: string | null; editors: { id: number; name: string }[];
  briefId: string | null; editDone: number | null; delivered: number | null; assigned: number | null;
  created: number | null; updated: number | null; closed: number | null;
};

type CuTaskFull = CuTask & {
  status?: { status?: string; type?: string };
  list?: { id?: string; name?: string };
  date_updated?: string; date_closed?: string | null; date_done?: string | null;
};

const ms = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function mirror(t: CuTaskFull): MirroredTask {
  const f = (id: string) => t.custom_fields?.find(c => c.id === id)?.value;
  const editorField = t.custom_fields?.find(c => c.id === EDITOR_FIELD_ID)?.value;
  const editors = (Array.isArray(editorField) ? editorField : [])
    .filter((u): u is { id: number; username?: string; email?: string } => !!u && typeof u === 'object' && 'id' in u)
    .map(u => ({ id: Number(u.id), name: u.username || u.email || `User ${u.id}` }));
  const brief = f(cfg.cu.briefFieldId);
  return {
    taskId: t.id, name: t.name, url: t.url || `https://app.clickup.com/t/${t.id}`,
    listId: t.list?.id ?? null, listName: t.list?.name ?? null,
    status: t.status?.status ?? null, statusType: t.status?.type ?? null, editors,
    briefId: typeof brief === 'string' && brief.trim() ? brief.trim() : null,
    editDone: ms(f(F_EDIT_COMPLETE)), delivered: ms(f(F_DELIVERED)), assigned: ms(f(F_ASSIGNED)),
    created: ms(t.date_created), updated: ms(t.date_updated), closed: ms(t.date_done ?? t.date_closed),
  };
}

/**
 * One page (100) of workspace tasks that have someone in the Editor field and were updated after `sinceMs`,
 * oldest update first, so tasks edited while we page move to the end instead of being skipped.
 */
export async function editorTasksPage(sinceMs: number, page: number, opts: { reverse?: boolean } = {}) {
  const filter = JSON.stringify([{ field_id: EDITOR_FIELD_ID, operator: 'IS NOT NULL' }]);
  const params = new URLSearchParams({
    include_closed: 'true', subtasks: 'true', order_by: 'updated', reverse: String(opts.reverse ?? true),
    date_updated_gt: String(sinceMs), page: String(page), custom_fields: filter,
  });
  const res = await cuFetch(`/team/${cfg.cu.teamId}/task?${params}`);
  if (!res.ok) throw new Error(`ClickUp ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { tasks?: CuTaskFull[]; last_page?: boolean };
  const tasks = (body.tasks ?? []).map(mirror);
  return { tasks, lastPage: body.last_page !== false || tasks.length === 0 };
}

// ------------------------------------------------------------------ agency workspace (read-only check)

/**
 * What CLICKUP_AGENCY_TOKEN can see: every workspace, and for each one other than ours, its spaces, how many tasks
 * the token can read, and which custom fields those tasks carry (to find the Editor / Brief ID fields). Read-only.
 */
export async function agencyAccessCheck(): Promise<Record<string, unknown>> {
  const token = process.env.CLICKUP_AGENCY_TOKEN?.trim();
  if (!token) return { configured: false, hint: 'Add CLICKUP_AGENCY_TOKEN in Vercel → Settings → Environment Variables, then redeploy.' };
  const get = async (path: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: token }, cache: 'no-store' });
    return { status: res.status, body: await res.json().catch(() => null) as Record<string, unknown> | null };
  };
  const user = await get('/user');
  const teams = await get('/team');
  const list = ((teams.body?.teams ?? []) as { id: string; name: string }[]);
  const out: Record<string, unknown>[] = [];
  for (const t of list) {
    if (t.id === cfg.cu.teamId) { out.push({ id: t.id, name: t.name, note: 'our workspace' }); continue; }
    const spaces = await get(`/team/${t.id}/space?archived=false`);
    const tasks = await get(`/team/${t.id}/task?include_closed=true&subtasks=true&page=0`);
    const ts = ((tasks.body?.tasks ?? []) as CuTask[]);
    const fields = new Map<string, { id: string; type: string; filled: number }>();
    for (const task of ts) for (const f of task.custom_fields ?? []) {
      const e = fields.get(f.name) ?? { id: f.id, type: f.type, filled: 0 };
      if (f.value != null && f.value !== '') e.filled++;
      fields.set(f.name, e);
    }
    out.push({
      id: t.id, name: t.name,
      spaces: spaces.status === 200 ? ((spaces.body?.spaces ?? []) as { name: string }[]).map(s => s.name) : `HTTP ${spaces.status}`,
      tasksOnFirstPage: tasks.status === 200 ? ts.length : `HTTP ${tasks.status}: ${JSON.stringify(tasks.body).slice(0, 160)}`,
      sampleTasks: ts.slice(0, 5).map(x => x.name),
      customFields: Object.fromEntries([...fields].sort((a, b) => b[1].filled - a[1].filled)),
    });
  }
  const u = user.body?.user as { username?: string } | undefined;
  return { configured: true, tokenUser: u?.username ?? `HTTP ${user.status}`, workspaces: out };
}
