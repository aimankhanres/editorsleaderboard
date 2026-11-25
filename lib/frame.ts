/**
 * Frame.io v4 (Adobe sign-in): read-only access used to measure minutes of finished video.
 * OAuth Web App credential from the Adobe Developer Console (FRAMEIO_CLIENT_ID / FRAMEIO_CLIENT_SECRET).
 * One person connects once (/api/frame/connect); the refresh token is kept in kv `frame_tokens`.
 * Nothing is ever written to Frame.io.
 */
import { kvGet, kvSet, ensureTaskTables } from './store';

const IMS = 'https://ims-na1.adobelogin.com/ims';
const API = 'https://api.frame.io/v4';
export const FRAME_SCOPES = 'openid,email,profile,offline_access,additional_info.roles';
const env = (k: string) => process.env[k]?.trim() ?? '';
export const frameClientId = () => env('FRAMEIO_CLIENT_ID') || env('FRAME_CLIENT_ID') || env('FRAMEIO_API_KEY');
const frameSecret = () => env('FRAMEIO_CLIENT_SECRET') || env('FRAME_CLIENT_SECRET');
export const frameConfigured = () => !!(frameClientId() && frameSecret());

type Tokens = { access: string; refresh: string; expires: number; user?: string | null; connectedAt: string };

export function authorizeUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({ client_id: frameClientId(), redirect_uri: redirectUri, scope: FRAME_SCOPES, response_type: 'code', state });
  return `${IMS}/authorize/v2?${p}`;
}

async function tokenCall(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const res = await fetch(`${IMS}/token/v3`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: frameClientId(), client_secret: frameSecret(), ...body }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`Adobe token ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

export async function connected(): Promise<boolean> {
  await ensureTaskTables();
  return !!(await kvGet<Tokens>('frame_tokens'))?.refresh;
}

export async function exchangeCode(code: string): Promise<void> {
  const t = await tokenCall({ grant_type: 'authorization_code', code });
  if (!t.refresh_token) throw new Error('Adobe returned no refresh token (offline_access scope missing on the credential?)');
  await ensureTaskTables();
  await kvSet('frame_tokens', { access: t.access_token, refresh: t.refresh_token, expires: Date.now() + (t.expires_in - 120) * 1000, connectedAt: new Date().toISOString() } satisfies Tokens);
}

export async function disconnect(): Promise<void> {
  await kvSet('frame_tokens', {});
}

async function accessToken(): Promise<string> {
  const t = await kvGet<Tokens>('frame_tokens');
  if (!t?.refresh) throw new Error('Frame.io is not connected');
  if (t.access && t.expires > Date.now()) return t.access;
  const n = await tokenCall({ grant_type: 'refresh_token', refresh_token: t.refresh });
  await kvSet('frame_tokens', { ...t, access: n.access_token, refresh: n.refresh_token ?? t.refresh, expires: Date.now() + (n.expires_in - 120) * 1000 });
  return n.access_token;
}

export async function frameGet<T = unknown>(path: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (res.status === 429) throw new Error('FRAME_RATE_LIMIT');
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}

/** File id from a Frame link: next.frame.io/project/<p>/view/<file>, or any URL carrying a UUID after /view/ or /reviews/ */
export function fileIdFromUrl(url: string): string | null {
  const m = url.match(/\/(?:view|player|reviews?\/[^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
    ?? url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?!.*[0-9a-f]{8}-)/i);
  return m?.[1] ?? null;
}

/** Follow an f.io short link (and any further redirects) to the full Frame URL, without loading the page */
export async function resolveLink(url: string): Promise<string> {
  let cur = url;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(cur, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    const loc = res.headers.get('location');
    if (!loc || res.status < 300 || res.status >= 400) return cur;
    cur = new URL(loc, cur).toString();
  }
  return cur;
}

// ------------------------------------------------------------------ video durations (minutes of content)

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
type Meta = { field_definition_name?: string; value?: unknown };
type FrameEntity = { id: string; type?: string; name?: string; media_type?: string; head_version?: { id: string; type?: string; media_type?: string }; metadata?: Meta[] };
let accountCache: string | null = null;

async function accountId(): Promise<string> {
  if (accountCache) return accountCache;
  const r = await frameGet<{ data?: { id: string }[] }>('/accounts');
  const id = r.body?.data?.[0]?.id;
  if (!id) throw new Error(`Frame accounts ${r.status}`);
  return (accountCache = id);
}

let lastFrameCall = 0;
async function slowGet<T>(path: string) {
  const wait = lastFrameCall + 700 - Date.now(); // stay under 100 calls / minute
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastFrameCall = Date.now();
  return frameGet<T>(path);
}

export type Duration = { kind: 'video' | 'image' | 'other' | 'share' | 'unresolved' | 'error'; fileId: string | null; seconds: number | null; mediaType: string | null; name: string | null; error?: string };

/** Seconds of one file (a version stack counts its latest version); null for non-video */
async function fileSeconds(acc: string, e: FrameEntity): Promise<{ seconds: number | null; mediaType: string | null; name: string | null; id: string }> {
  const id = e.type === 'version_stack' ? e.head_version?.id ?? e.id : e.id;
  const f = await slowGet<{ data?: FrameEntity }>(`/accounts/${acc}/files/${id}?include=metadata`);
  const d = f.body?.data;
  const dur = d?.metadata?.find(x => x.field_definition_name === 'Duration')?.value;
  const mt = d?.media_type ?? null;
  return { id, seconds: typeof dur === 'number' && dur > 0 && (!mt || mt.startsWith('video')) ? dur : null, mediaType: mt, name: d?.name ?? null };
}

/**
 * Length of exactly what a ClickUp "Frame Io Link" points to: f.io short link -> share URL -> that one asset (a version
 * stack counts its latest version), from Frame's metadata "Duration" (seconds). A share link counts only when the share
 * holds a single asset. Links to folders or multi-asset shares have no single length, so they count no minutes.
 */
export async function durationOf(link: string): Promise<Duration> {
  const to = await resolveLink(link);
  const share = to.match(new RegExp(`/share/(${UUID})(?:/(?:view/)?(${UUID}))?`, 'i'));
  const direct = to.match(new RegExp(`/(?:view|player)/(${UUID})`, 'i'));
  const acc = await accountId();
  let itemId = share?.[2] ?? direct?.[1] ?? null;
  const none = (kind: Duration['kind'], name: string, fileId: string | null = itemId): Duration => ({ kind, fileId, seconds: null, mediaType: null, name });
  let entity: FrameEntity | null = null;
  if (!itemId) {
    if (!share) return none('unresolved', 'not a Frame share link');
    const a = await slowGet<{ data?: FrameEntity[] }>(`/accounts/${acc}/shares/${share[1]}/assets`);
    if (a.status !== 200) return { ...none('error', ''), error: `share assets ${a.status}` };
    const items = a.body.data ?? [];
    if (items.length !== 1 || items[0].type === 'folder') return none('share', `share with ${items.length} items`, share[1]);
    entity = items[0];
    itemId = entity.id;
  } else {
    const vs = await slowGet<{ data?: FrameEntity }>(`/accounts/${acc}/version_stacks/${itemId}`);
    if (vs.status === 200 && vs.body.data) entity = { ...vs.body.data, type: 'version_stack' };
    else {
      const f = await slowGet<{ data?: FrameEntity }>(`/accounts/${acc}/files/${itemId}`);
      if (f.status === 200 && f.body.data) entity = { ...f.body.data, type: 'file' };
      else if (f.status === 422) return none('share', 'link is a folder');
      else return { ...none('error', ''), error: `item ${f.status}` };
    }
  }
  const f = await fileSeconds(acc, entity);
  if (!f.seconds) return { kind: f.mediaType?.startsWith('image') ? 'image' : 'other', fileId: f.id, seconds: null, mediaType: f.mediaType, name: f.name };
  return { kind: 'video', fileId: f.id, seconds: f.seconds, mediaType: f.mediaType, name: f.name };
}
