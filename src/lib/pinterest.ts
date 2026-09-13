/**
 * Pinterest OAuth 2.0 + read helpers (v5 API).
 *
 * Per-couple connection powering the Wedding Planner inspiration board. Follows the
 * QuickBooks/FreshBooks OAuth template (src/lib/accounting.ts): confidential
 * client, Basic-auth token exchange, refresh-token rotation. Tokens are stored
 * (encrypted) in the couple_integrations table.
 *
 * NOTE: requires PINTEREST_CLIENT_ID / PINTEREST_CLIENT_SECRET env vars and a
 * Pinterest app with Standard access to work for real brides. Until those are
 * set, isPinterestConfigured() is false and the connect route returns a clear
 * "not configured" error.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { getTrustedAppOrigin } from '@/lib/safe-redirect';
import { encryptToken, decryptToken } from '@/lib/crypto-tokens';

const CLIENT_ID = process.env.PINTEREST_CLIENT_ID || '';
const CLIENT_SECRET = process.env.PINTEREST_CLIENT_SECRET || '';
const SCOPES = 'boards:read,pins:read,user_accounts:read';
const AUTH_URL = 'https://www.pinterest.com/oauth/';
const TOKEN_URL = 'https://api.pinterest.com/v5/oauth/token';
const API_BASE = 'https://api.pinterest.com/v5';
const PROVIDER = 'pinterest';

export function isPinterestConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

export function getPinterestRedirectUri(): string {
  return process.env.PINTEREST_REDIRECT_URI || `${getTrustedAppOrigin()}/api/couple/integrations/pinterest/callback`;
}

// ── OAuth "state" signing (couple id travels through the redirect safely) ──────
// The OAuth callback is a top-level browser redirect with no Bearer token, so we
// carry the couple id in an HMAC-signed state param and verify it on return.

function stateSecret(): string {
  return process.env.TOKEN_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'storyvenue-pinterest-state';
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function signState(coupleId: string): string {
  const payload = b64url(Buffer.from(JSON.stringify({ c: coupleId, t: Date.now() })));
  const sig = b64url(createHmac('sha256', stateSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyState(state: string | null | undefined): string | null {
  if (!state || !state.includes('.')) return null;
  const [payload, sig] = state.split('.');
  if (!payload || !sig) return null;
  const expected = b64url(createHmac('sha256', stateSecret()).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const coupleId = typeof json.c === 'string' ? json.c : null;
    // Reject states older than 1 hour.
    if (!coupleId || typeof json.t !== 'number' || Date.now() - json.t > 3_600_000) return null;
    return coupleId;
  } catch {
    return null;
  }
}

export function getPinterestAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: getPinterestRedirectUri(),
    response_type: 'code',
    scope: SCOPES,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  message?: string;
}

function basicAuthHeader(): string {
  return `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
}

export async function exchangePinterestCode(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getPinterestRedirectUri(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  return (await res.json().catch(() => ({}))) as TokenResponse;
}

export async function refreshPinterestToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    signal: AbortSignal.timeout(30_000),
  });
  return (await res.json().catch(() => ({}))) as TokenResponse;
}

// ── Connection storage (couple_integrations) ──────────────────────────────────

export interface PinterestConnection {
  connected: boolean;
  username: string | null;
}

interface ConnectionRow {
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  provider_username: string | null;
}

async function getConnectionRow(coupleId: string): Promise<ConnectionRow | null> {
  const { data } = await supabaseAdmin
    .from('couple_integrations')
    .select('access_token, refresh_token, token_expires_at, provider_username')
    .eq('couple_id', coupleId)
    .eq('provider', PROVIDER)
    .maybeSingle();
  return (data as ConnectionRow | null) ?? null;
}

export async function getPinterestConnection(coupleId: string): Promise<PinterestConnection> {
  const row = await getConnectionRow(coupleId);
  if (!row || !row.access_token) return { connected: false, username: null };
  return { connected: true, username: row.provider_username };
}

export async function upsertPinterestConnection(
  coupleId: string,
  tokens: TokenResponse,
  account: { username?: string | null; id?: string | null },
): Promise<void> {
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;
  await supabaseAdmin.from('couple_integrations').upsert(
    {
      couple_id: coupleId,
      provider: PROVIDER,
      access_token: encryptToken(tokens.access_token ?? null),
      refresh_token: encryptToken(tokens.refresh_token ?? null),
      token_expires_at: expiresAt,
      scope: tokens.scope ?? SCOPES,
      provider_user_id: account.id ?? null,
      provider_username: account.username ?? null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'couple_id,provider' },
  );
}

export async function disconnectPinterest(coupleId: string): Promise<void> {
  await supabaseAdmin
    .from('couple_integrations')
    .delete()
    .eq('couple_id', coupleId)
    .eq('provider', PROVIDER);
}

/**
 * Return a valid access token for the couple, refreshing (and persisting) it if
 * it is missing/expired. Returns null if there is no connection.
 */
export async function ensurePinterestToken(coupleId: string): Promise<string | null> {
  const row = await getConnectionRow(coupleId);
  if (!row || !row.access_token) return null;

  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  const stillValid = expiresAt && expiresAt - Date.now() > 120_000; // 2-min skew
  if (stillValid) return decryptToken(row.access_token);

  const refresh = decryptToken(row.refresh_token);
  if (!refresh) return decryptToken(row.access_token); // no refresh token — use what we have

  const refreshed = await refreshPinterestToken(refresh);
  if (!refreshed.access_token) return decryptToken(row.access_token);

  const newExpiry = refreshed.expires_in
    ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
    : null;
  await supabaseAdmin
    .from('couple_integrations')
    .update({
      access_token: encryptToken(refreshed.access_token),
      // Pinterest may or may not rotate the refresh token; keep the old one if absent.
      refresh_token: refreshed.refresh_token ? encryptToken(refreshed.refresh_token) : row.refresh_token,
      token_expires_at: newExpiry,
      updated_at: new Date().toISOString(),
    })
    .eq('couple_id', coupleId)
    .eq('provider', PROVIDER);

  return refreshed.access_token;
}

// ── Read API ──────────────────────────────────────────────────────────────────

async function apiGet<T>(accessToken: string, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.error('[pinterest apiGet]', path, res.status, await res.text().catch(() => ''));
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.error('[pinterest apiGet]', path, e);
    return null;
  }
}

export interface PinterestUserAccount {
  username?: string;
  id?: string;
}

export async function fetchUserAccount(accessToken: string): Promise<PinterestUserAccount | null> {
  return apiGet<PinterestUserAccount>(accessToken, '/user_account');
}

export interface PinterestBoardSummary {
  id: string;
  name: string;
  coverImageUrl: string | null;
  pinCount: number | null;
}

interface RawBoard {
  id: string;
  name: string;
  pin_count?: number;
  media?: { image_cover_url?: string; pin_thumbnail_urls?: string[] };
}

export async function listBoards(accessToken: string): Promise<PinterestBoardSummary[]> {
  const data = await apiGet<{ items?: RawBoard[] }>(accessToken, '/boards?page_size=100');
  const items = data?.items ?? [];
  return items.map((b) => ({
    id: b.id,
    name: b.name,
    coverImageUrl: b.media?.image_cover_url || b.media?.pin_thumbnail_urls?.[0] || null,
    pinCount: typeof b.pin_count === 'number' ? b.pin_count : null,
  }));
}

export interface PinterestPinSummary {
  id: string;
  imageUrl: string | null;
  linkUrl: string;
  title: string | null;
}

interface RawPin {
  id: string;
  title?: string;
  description?: string;
  link?: string;
  media?: { images?: Record<string, { url?: string; width?: number }> };
}

function pickPinImage(media: RawPin['media']): string | null {
  const images = media?.images;
  if (!images) return null;
  const preferred = ['1200x', '600x', '564x', '400x300', '150x150'];
  for (const key of preferred) {
    if (images[key]?.url) return images[key]!.url!;
  }
  // Fall back to the widest available.
  let best: { url?: string; width?: number } | null = null;
  for (const v of Object.values(images)) {
    if (v?.url && (!best || (v.width ?? 0) > (best.width ?? 0))) best = v;
  }
  return best?.url ?? null;
}

export async function listBoardPins(accessToken: string, boardId: string): Promise<PinterestPinSummary[]> {
  const data = await apiGet<{ items?: RawPin[] }>(accessToken, `/boards/${encodeURIComponent(boardId)}/pins?page_size=100`);
  const items = data?.items ?? [];
  return items.map((p) => ({
    id: p.id,
    imageUrl: pickPinImage(p.media),
    linkUrl: p.link || `https://www.pinterest.com/pin/${p.id}/`,
    title: p.title || p.description || null,
  }));
}
