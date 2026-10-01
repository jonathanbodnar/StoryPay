import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const APP_HOSTS = new Set(['app.storyvenue.com']);

/**
 * Tenant-session cookies we verify + lifetime-enforce on every request.
 * See src/lib/venue-session.ts for how they are issued.
 *   <id>       raw tenant/member UUID (read directly by handlers)
 *   <id>_meta  "<iat>.<idle>.<absCap>"  issue time + idle window + this
 *              session's own absolute cap, all in seconds. The absCap segment
 *              is new — older sessions only have "<iat>.<idle>" and fall back
 *              to the legacy 7-day ABSOLUTE_MAX_SECONDS below.
 *   <id>_sig   HMAC-SHA256(secret, "<id>=<value>.<meta>")
 */
const SIGNED_COOKIES: Array<{ id: string; table: string }> = [
  { id: 'venue_id', table: 'venues' },
  { id: 'member_id', table: 'venue_team_members' },
];

const ABSOLUTE_MAX_SECONDS = 60 * 60 * 24 * 7; // 7-day hard cap (web default/legacy)
const IDLE_SECONDS = 60 * 60 * 8;              // 8-hour idle (default / legacy)

function getSecret(): string | undefined {
  return (
    process.env.NEXTAUTH_SECRET ??
    process.env.ADMIN_SECRET ??
    process.env.LEAD_WEBHOOK_SECRET
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacBase64Url(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(message));
  return toBase64Url(new Uint8Array(sig));
}

/** Constant-time string compare. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/**
 * Routes that legitimately set/clear the tenant cookies in their own response.
 * We must NOT re-issue on these or the middleware Set-Cookie would collide with
 * (and can clobber) the handler's login/logout cookie.
 */
function mutatesAuthCookies(pathname: string): boolean {
  return (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/admin/impersonate') ||
    pathname.startsWith('/api/invite') ||
    pathname.includes('sign-out') ||
    pathname.includes('logout')
  );
}

/**
 * session_invalidated_before (unix seconds) for a tenant/member, whether the
 * row still exists, and (for members) its venue and status — cached ~60s.
 * Fails OPEN (row assumed present, nothing revoked) on any error so a DB
 * hiccup can never lock out every tenant. Uses a plain PostgREST fetch to stay
 * runtime-agnostic (no supabase-js).
 */
type RowInfo = { before: number; exists: boolean; venueId: string | null; status: string | null };
type RevEntry = { info: RowInfo; exp: number };
const revCache = new Map<string, RevEntry>();
const REV_TTL_MS = 60_000;
const FAIL_OPEN: RowInfo = { before: 0, exists: true, venueId: null, status: null };

async function sessionRow(table: string, id: string): Promise<RowInfo> {
  const cacheKey = `${table}:${id}`;
  const now = Date.now();
  const hit = revCache.get(cacheKey);
  if (hit && hit.exp > now) return hit.info;

  let info: RowInfo = FAIL_OPEN;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && svc) {
      const cols = table === 'venue_team_members' ? 'session_invalidated_before,venue_id,status' : 'session_invalidated_before';
      const res = await fetch(
        `${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=${cols}`,
        { headers: { apikey: svc, Authorization: `Bearer ${svc}` }, cache: 'no-store' },
      );
      if (res.ok) {
        const rows = (await res.json()) as Array<{ session_invalidated_before: string | null; venue_id?: string | null; status?: string | null }>;
        const row = rows?.[0];
        const t = row?.session_invalidated_before;
        info = {
          before: t ? Math.floor(new Date(t).getTime() / 1000) : 0,
          exists: !!row,
          venueId: row?.venue_id ?? null,
          status: row?.status ?? null,
        };
      }
    }
  } catch {
    // fail open
  }
  revCache.set(cacheKey, { info, exp: now + REV_TTL_MS });
  return info;
}

/** Does this venue have team members? Cached ~60s; fails closed to "no". */
const teamCache = new Map<string, { has: boolean; exp: number }>();
async function venueHasTeam(venueId: string): Promise<boolean> {
  const now = Date.now();
  const hit = teamCache.get(venueId);
  if (hit && hit.exp > now) return hit.has;
  let has = false;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && svc) {
      const res = await fetch(
        `${url}/rest/v1/venue_team_members?venue_id=eq.${encodeURIComponent(venueId)}&select=id&limit=1`,
        { headers: { apikey: svc, Authorization: `Bearer ${svc}` }, cache: 'no-store' },
      );
      if (res.ok) has = ((await res.json()) as unknown[]).length > 0;
    }
  } catch {
    // fail open
  }
  teamCache.set(venueId, { has, exp: now + REV_TTL_MS });
  return has;
}

/** A team member who was removed or switched off can't keep a session. */
function memberUsable(info: RowInfo, venueId: string): boolean {
  if (!info.exists) return false;
  if (info.status && ['inactive', 'disabled', 'removed', 'suspended'].includes(info.status)) return false;
  return !info.venueId || info.venueId === venueId;
}

type Reissue = { id: string; value: string; iat: number; idle: number; absCap: number; principal: string };

export async function proxy(request: NextRequest) {
  const host = request.headers.get('host')?.toLowerCase() ?? '';
  const hostname = host.split(':')[0];

  if (APP_HOSTS.has(hostname) && request.nextUrl.pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url, 307);
  }

  const secret = getSecret();
  // Without a signing secret we cannot verify. Fail OPEN so a misconfiguration
  // can't lock every tenant out — the signing side fails loudly on its own.
  if (!secret) return NextResponse.next();

  const nowSecs = Math.floor(Date.now() / 1000);
  const toStrip = new Set<string>();
  const reissue: Reissue[] = [];
  let venuePrincipal = '';

  for (const { id, table } of SIGNED_COOKIES) {
    const sigName = `${id}_sig`;
    const metaName = `${id}_meta`;
    const value = request.cookies.get(id)?.value;
    if (!value) continue; // no id cookie → nothing to trust

    const providedSig = request.cookies.get(sigName)?.value;
    const metaVal = request.cookies.get(metaName)?.value;

    const strip = () => {
      toStrip.add(id);
      toStrip.add(sigName);
      toStrip.add(metaName);
    };

    if (metaVal) {
      // Current format: signature binds id + value + meta.
      const expected = await hmacBase64Url(secret, `${id}=${value}.${metaVal}`);
      if (!providedSig || !safeEqual(providedSig, expected)) {
        strip();
        continue;
      }
      // meta is "<iat>.<idle>" (legacy, 2 parts) or "<iat>.<idle>.<absCap>"
      // (current, 3 parts — lets native sessions carry their own 90-day cap
      // instead of the global 7-day web default).
      const parts = metaVal.split('.');
      const iat = Number(parts[0]);
      const idle = Number(parts[1]) || IDLE_SECONDS;
      const absCap = Number(parts[2]) || ABSOLUTE_MAX_SECONDS;
      if (!Number.isFinite(iat) || nowSecs - iat > absCap) {
        strip(); // this session's absolute cap exceeded
        continue;
      }
      const row = await sessionRow(table, value);
      if (!row.exists || (row.before && iat < row.before)) {
        strip(); // account gone, or session revoked server-side
        continue;
      }
      // venue_id metas carry who signed in: "o" (owner) or "m-<member id>".
      const principal = id === 'venue_id' ? (parts[3] ?? '') : '';
      if (id === 'venue_id') venuePrincipal = principal;
      reissue.push({ id, value, iat, idle, absCap, principal });
    } else {
      // Legacy format (pre-metadata): HMAC(id=value). Verify once, then migrate.
      const expectedLegacy = await hmacBase64Url(secret, `${id}=${value}`);
      if (!providedSig || !safeEqual(providedSig, expectedLegacy)) {
        strip();
        continue;
      }
      const row = await sessionRow(table, value);
      if (!row.exists || (row.before && nowSecs < row.before)) {
        strip();
        continue;
      }
      reissue.push({ id, value, iat: nowSecs, idle: IDLE_SECONDS, absCap: ABSOLUTE_MAX_SECONDS, principal: '' });
    }
  }

  // Who the venue session belongs to. A team member's session ends when they're
  // removed or switched off, and clearing the member_id cookie never turns a
  // member into the owner: new sessions record the principal in the signed
  // venue_id meta; an older session without one, at a venue that has a team,
  // has to sign in again unless it carries a valid member_id.
  const stripPair = (id: string) => { toStrip.add(id); toStrip.add(`${id}_sig`); toStrip.add(`${id}_meta`); };
  const venueVal = toStrip.has('venue_id') ? undefined : request.cookies.get('venue_id')?.value;
  const memberVal = toStrip.has('member_id') ? undefined : request.cookies.get('member_id')?.value;
  if (venueVal) {
    if (venuePrincipal.startsWith('m-')) {
      if (!memberUsable(await sessionRow('venue_team_members', venuePrincipal.slice(2)), venueVal)) {
        stripPair('venue_id');
        stripPair('member_id');
      }
    } else if (venuePrincipal !== 'o') {
      if (memberVal) {
        if (!memberUsable(await sessionRow('venue_team_members', memberVal), venueVal)) {
          stripPair('venue_id');
          stripPair('member_id');
        }
      } else if (await venueHasTeam(venueVal)) {
        stripPair('venue_id');
      }
    }
  }
  if (toStrip.has('venue_id') && request.cookies.get('member_id')?.value) stripPair('member_id');
  for (let i = reissue.length - 1; i >= 0; i--) {
    if (toStrip.has(reissue[i].id)) reissue.splice(i, 1);
  }

  if (toStrip.size === 0 && reissue.length === 0) {
    return NextResponse.next();
  }

  // Rebuild the forwarded Cookie header without the untrusted cookies so every
  // handler (including the ~150 that read venue_id directly) sees an
  // unauthenticated request rather than trusting a forged/expired/revoked id.
  const remaining = request.cookies.getAll().filter((c) => !toStrip.has(c.name));
  const requestHeaders = new Headers(request.headers);
  if (remaining.length > 0) {
    requestHeaders.set('cookie', remaining.map((c) => `${c.name}=${c.value}`).join('; '));
  } else {
    requestHeaders.delete('cookie');
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });

  // Sliding-window refresh: re-issue valid sessions with a fresh idle window,
  // capped by the absolute 7-day limit. Skipped on auth-mutating routes so we
  // never collide with a login/logout Set-Cookie in the same round-trip.
  if (reissue.length > 0 && !mutatesAuthCookies(request.nextUrl.pathname)) {
    for (const { id, value, iat, idle, absCap, principal } of reissue) {
      const remainingToCap = absCap - (nowSecs - iat);
      if (remainingToCap <= 0) continue;
      const maxAge = Math.min(idle, remainingToCap);
      // Always re-issue in the current format (keeping the venue principal) so
      // legacy (2-part) sessions are upgraded on their first refresh.
      const meta = `${iat}.${idle}.${absCap}${principal ? `.${principal}` : ''}`;
      const sig = await hmacBase64Url(secret, `${id}=${value}.${meta}`);
      const opts = { path: '/', httpOnly: true, secure: true, sameSite: 'lax' as const, maxAge };
      res.cookies.set(id, value, opts);
      res.cookies.set(`${id}_meta`, meta, opts);
      res.cookies.set(`${id}_sig`, sig, opts);
    }
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
