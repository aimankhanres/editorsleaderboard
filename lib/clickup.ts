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

// ------------------------------------------------------------------ task mirror (capacity, briefs, #N matching)

/** Date fields read from every Resilia task (ms since epoch, as strings in the API) */
const F_EDIT_COMPLETE = 'e022405a-973d-41c9-bd6d-af5bfed99d68'; // "Edit Complete Date": editor finished
const F_DELIVERED = '8319778d-0b8e-4406-8db2-79075b773b85'; // "Asset Delivered Date"
const F_ASSIGNED = '0a93bbd8-98df-4ed6-90ce-7c9cb995b42d'; // "Editor Assigned Date"

export type Workspace = 'resilia' | 'agency';
export const AGENCY_TEAM_ID = process.env.CLICKUP_AGENCY_TEAM_ID?.trim() || '90141507124';
export const agencyToken = () => process.env.CLICKUP_AGENCY_TOKEN?.trim() ?? '';

/**
 * Lists in Resilia's workspace that are live pipelines (briefs move through them). They are mirrored in full,
 * including tasks with no Editor yet, so the Briefs screen can count what is waiting.
 */
export const PIPELINE_LISTS = [
  '901614785376', '901614380046', '901616741550', // Oregano / Garlic / Cinnamon internal pipelines
  '1300340000000866', '1300340000001523', '1300340000009738', // Variations
  '901615541251', // Main-Google/YT Iterations Pipeline
  '1300340000008474', '1300340000008475', '1300340000008385', // Google/YT Variants resizing
  '1300340000009707', '1300340000009691', '1300340000009709', // Variation & Resizing space
];

export type UserRef = { id: number; name: string };
export type MirroredTask = {
  workspace: Workspace;
  taskId: string; name: string; url: string; listId: string | null; listName: string | null;
  status: string | null; statusType: string | null; editors: UserRef[];
  strategists: UserRef[]; seniors: UserRef[];
  briefId: string | null; editDone: number | null; delivered: number | null; assigned: number | null;
  created: number | null; updated: number | null; closed: number | null;
  /** "Size" labels (Static 4x5, Vertical 9x16 …), "Video Format/Style", "Product (SKU)", agency "Team", Frame link */
  sizes: string[]; format: string | null; product: string | null; team: string | null; frameUrl: string | null;
  /** "Total Revisions" (Resilia) / "Total Revision Count" (agency) */
  revisions: number | null;
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

const users = (v: unknown): UserRef[] => (Array.isArray(v) ? v : [])
  .filter((u): u is { id: number; username?: string; email?: string } => !!u && typeof u === 'object' && 'id' in u)
  .map(u => ({ id: Number(u.id), name: u.username || u.email || `User ${u.id}` }));

/** Text of a drop_down (value = option orderindex or id) or labels (value = option ids) field */
function optionNames(f: CuField | undefined): string[] {
  if (!f || f.value == null || f.value === '') return [];
  const opts = f.type_config?.options ?? [];
  const vals = Array.isArray(f.value) ? f.value : [f.value];
  return vals.map(v => {
    const o = opts.find(o => o.id === v || String(o.orderindex) === String(v));
    return (o?.name ?? o?.label ?? (typeof v === 'string' ? v : '')).trim();
  }).filter(Boolean);
}

function mirror(t: CuTaskFull, workspace: Workspace): MirroredTask {
  const byName = (n: string) => t.custom_fields?.find(c => c.name.trim().toLowerCase() === n);
  const byId = (id: string) => t.custom_fields?.find(c => c.id === id);
  const res = workspace === 'resilia';
  const val = (id: string, name: string) => (res ? byId(id) : byName(name))?.value;
  const brief = val(cfg.cu.briefFieldId, 'brief id');
  const frame = byName('frame io link')?.value;
  return {
    workspace,
    taskId: t.id, name: t.name, url: t.url || `https://app.clickup.com/t/${t.id}`,
    listId: t.list?.id ?? null, listName: t.list?.name ?? null,
    status: t.status?.status ?? null, statusType: t.status?.type ?? null,
    editors: users(val(EDITOR_FIELD_ID, 'editor')),
    strategists: users(byName('strategist')?.value),
    seniors: users((byName('sr editor') ?? byName('senior editor'))?.value),
    briefId: typeof brief === 'string' && brief.trim() ? brief.trim() : null,
    editDone: ms(val(F_EDIT_COMPLETE, 'edit complete date')), delivered: ms(val(F_DELIVERED, 'asset delivered date')),
    assigned: ms(val(F_ASSIGNED, 'editor assigned date')),
    created: ms(t.date_created), updated: ms(t.date_updated), closed: ms(t.date_done ?? t.date_closed),
    sizes: optionNames(byName('size')),
    format: optionNames(byName('video format/style'))[0] ?? null,
    product: optionNames(byName('product (sku)'))[0] ?? null,
    team: optionNames(byName('team'))[0] ?? null,
    frameUrl: typeof frame === 'string' && frame.trim() ? frame.trim() : null,
    revisions: (v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)))((byName('total revisions') ?? byName('total revision count'))?.value),
  };
}

/** The mirror streams: every Resilia task with an Editor; every task in the live pipelines; the agency workspace. */
export type MirrorStream = 'editor' | 'pipeline' | 'agency';

let lastAgencyCall = 0;
async function agencyFetch(path: string): Promise<Response> {
  const wait = lastAgencyCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastAgencyCall = Date.now();
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: agencyToken() }, cache: 'no-store' });
  if (res.status === 429) throw new RateLimited('ClickUp rate limit (429, agency token)');
  return res;
}

/**
 * One page (100) of a stream's tasks updated after `sinceMs`, oldest update first, so tasks edited while we page
 * move to the end instead of being skipped.
 */
export async function streamTasksPage(stream: MirrorStream, sinceMs: number, page: number, opts: { reverse?: boolean } = {}) {
  const params = new URLSearchParams({
    include_closed: 'true', subtasks: 'true', order_by: 'updated', reverse: String(opts.reverse ?? true),
    date_updated_gt: String(sinceMs), page: String(page),
  });
  if (stream === 'editor') params.set('custom_fields', JSON.stringify([{ field_id: EDITOR_FIELD_ID, operator: 'IS NOT NULL' }]));
  if (stream === 'pipeline') for (const l of PIPELINE_LISTS) params.append('list_ids[]', l);
  const res = stream === 'agency'
    ? await agencyFetch(`/team/${AGENCY_TEAM_ID}/task?${params}`)
    : await cuFetch(`/team/${cfg.cu.teamId}/task?${params}`);
  if (!res.ok) throw new Error(`ClickUp ${stream} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { tasks?: CuTaskFull[]; last_page?: boolean };
  const tasks = (body.tasks ?? []).map(t => mirror(t, stream === 'agency' ? 'agency' : 'resilia'));
  return { tasks, lastPage: body.last_page !== false || tasks.length === 0 };
}

/** Back-compat: the editor stream */
export const editorTasksPage = (sinceMs: number, page: number, opts: { reverse?: boolean } = {}) => streamTasksPage('editor', sinceMs, page, opts);

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

// ------------------------------------------------------------------ workspace members (emails, read-only)

export type CuUser = { id: number; name: string; email: string | null };
/** Every member of Resilia's workspace and (with the agency token) the agency workspace, with their email */
export async function workspaceUsers(): Promise<CuUser[]> {
  const out = new Map<number, CuUser>();
  for (const token of [cfg.cu.token, agencyToken()].filter(Boolean)) {
    const res = await fetch(`${BASE}/team`, { headers: { Authorization: token }, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    if (!res.ok) continue;
    const body = (await res.json()) as { teams?: { members?: { user?: { id: number; username?: string; email?: string } }[] }[] };
    for (const t of body.teams ?? []) for (const m of t.members ?? []) {
      const u = m.user;
      if (u?.id && !out.has(u.id)) out.set(u.id, { id: Number(u.id), name: u.username || u.email || `User ${u.id}`, email: u.email?.toLowerCase() ?? null });
    }
  }
  return [...out.values()];
}

// ------------------------------------------------------------------ time in status (read-only)

/** Minutes each task spent in each status, by status name without its "6.1." numbering. Up to 100 tasks a call. */
export async function timeInStatus(ids: string[], workspace: Workspace): Promise<Map<string, Record<string, number>>> {
  const out = new Map<string, Record<string, number>>();
  if (!ids.length) return out;
  const qs = ids.slice(0, 100).map(id => `task_ids=${encodeURIComponent(id)}`).join('&');
  const res = workspace === 'agency' ? await agencyFetch(`/task/bulk_time_in_status/task_ids?${qs}`) : await cuFetch(`/task/bulk_time_in_status/task_ids?${qs}`);
  if (!res.ok) throw new Error(`ClickUp time in status ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const body = (await res.json()) as Record<string, { status_history?: { status?: string; total_time?: { by_minute?: number } | string; total_time_minutes?: number }[] }>;
  const map = (body as { tasks?: typeof body }).tasks ?? body;
  for (const [id, t] of Object.entries(map)) {
    const acc: Record<string, number> = {};
    for (const h of t?.status_history ?? []) {
      const name = (h.status ?? '').replace(/^[\d.\s]+/, '').trim().toLowerCase();
      const mins = typeof h.total_time === 'object' ? Number(h.total_time?.by_minute ?? 0) : Number(h.total_time_minutes ?? 0);
      if (name) acc[name] = (acc[name] ?? 0) + (Number.isFinite(mins) ? mins : 0);
    }
    out.set(id, acc);
  }
  return out;
}

// ------------------------------------------------------------------ audit helpers (read-only, live from ClickUp)

const AGENCY_EDITOR_FIELD_ID = process.env.CLICKUP_AGENCY_EDITOR_FIELD_ID || '2fe8880e-7427-4cea-977c-5e190a6ec358';

/**
 * Live from ClickUp: every task (Resilia + agency workspace) with this user in the Editor field, updated since
 * `sinceMs`, mirrored the same way as the sync. Used to re-count finished edits without the dashboard's copy.
 */
export async function liveEditorTasks(userId: number, sinceMs: number): Promise<MirroredTask[]> {
  const out: MirroredTask[] = [];
  const spaces: { ws: Workspace; team: string; field: string }[] = [{ ws: 'resilia', team: cfg.cu.teamId, field: EDITOR_FIELD_ID }];
  if (agencyToken()) spaces.push({ ws: 'agency', team: AGENCY_TEAM_ID, field: AGENCY_EDITOR_FIELD_ID });
  for (const sp of spaces) {
    for (let page = 0; page < 40; page++) {
      const params = new URLSearchParams({ include_closed: 'true', subtasks: 'true', page: String(page), date_updated_gt: String(sinceMs),
        custom_fields: JSON.stringify([{ field_id: sp.field, operator: 'ANY', value: [userId] }]) });
      const res = sp.ws === 'agency' ? await agencyFetch(`/team/${sp.team}/task?${params}`) : await cuFetch(`/team/${sp.team}/task?${params}`);
      if (!res.ok) throw new Error(`ClickUp ${sp.ws} ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const body = (await res.json()) as { tasks?: CuTaskFull[]; last_page?: boolean };
      for (const t of body.tasks ?? []) { const m = mirror(t, sp.ws); if (m.editors.some(e => e.id === userId)) out.push(m); }
      if (body.last_page !== false || !(body.tasks ?? []).length) break;
    }
  }
  return out;
}

/** Live from ClickUp: one task's Editor field (ids), in either workspace */
export async function liveTaskEditors(taskId: string, workspace: Workspace): Promise<number[] | null> {
  const res = workspace === 'agency' ? await agencyFetch(`/task/${taskId}`) : await cuFetch(`/task/${taskId}`);
  if (!res.ok) return null;
  return mirror((await res.json()) as CuTaskFull, workspace).editors.map(e => e.id);
}
