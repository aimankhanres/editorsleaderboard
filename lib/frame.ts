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
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` }, cache: 'no-store' });
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
    const res = await fetch(cur, { redirect: 'manual', cache: 'no-store' });
    const loc = res.headers.get('location');
    if (!loc || res.status < 300 || res.status >= 400) return cur;
    cur = new URL(loc, cur).toString();
  }
  return cur;
}
