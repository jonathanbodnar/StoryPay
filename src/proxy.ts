import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const APP_HOSTS = new Set(['app.storyvenue.com']);

/**
 * Tenant-session cookies we verify + lifetime-enforce on every request.
 * See src/lib/venue-session.ts for how they are issued.
 *   <id>       raw tenant/member UUID (read directly by handlers)
 *   <id>_meta  "<iat>.<idle>"  issue time + idle window, both in seconds
 *   <id>_sig   HMAC-SHA256(secret, "<id>=<value>.<meta>")
 */
const SIGNED_COOKIES: Array<{ id: string; table: string }> = [
  { id: 'venue_id', table: 'venues' },
  { id: 'member_id', table: 'venue_team_members' },
];

const ABSOLUTE_MAX_SECONDS = 60 * 60 * 24 * 7; // 7-day hard cap
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
 * session_invalidated_before (unix seconds) for a tenant/member, cached ~60s.
 * Fails OPEN (returns 0) on any error so a DB hiccup can never lock out every
 * tenant. Uses a plain PostgREST fetch to stay runtime-agnostic (no supabase-js).
 */
type RevEntry = { before: number; exp: number };
const revCache = new Map<string, RevEntry>();
const REV_TTL_MS = 60_000;

async function invalidatedBefore(table: string, id: string): Promise<number> {
  const cacheKey = `${table}:${id}`;
  const now = Date.now();
  const hit = revCache.get(cacheKey);
  if (hit && hit.exp > now) return hit.before;

  let before = 0;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && svc) {
      const res = await fetch(
        `${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=session_invalidated_before`,
        { headers: { apikey: svc, Authorization: `Bearer ${svc}` }, cache: 'no-store' },
      );
      if (res.ok) {
        const rows = (await res.json()) as Array<{ session_invalidated_before: string | null }>;
        const t = rows?.[0]?.session_invalidated_before;
        if (t) before = Math.floor(new Date(t).getTime() / 1000);
      }
    }
  } catch {
    // fail open
  }
  revCache.set(cacheKey, { before, exp: now + REV_TTL_MS });
  return before;
}

type Reissue = { id: string; value: string; iat: number; idle: number };

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
      const dot = metaVal.indexOf('.');
      const iat = Number(metaVal.slice(0, dot));
      const idle = Number(metaVal.slice(dot + 1)) || IDLE_SECONDS;
      if (!Number.isFinite(iat) || nowSecs - iat > ABSOLUTE_MAX_SECONDS) {
        strip(); // absolute 7-day cap exceeded
        continue;
      }
      const before = await invalidatedBefore(table, value);
      if (before && iat < before) {
        strip(); // session revoked server-side
        continue;
      }
      reissue.push({ id, value, iat, idle });
    } else {
      // Legacy format (pre-metadata): HMAC(id=value). Verify once, then migrate.
      const expectedLegacy = await hmacBase64Url(secret, `${id}=${value}`);
      if (!providedSig || !safeEqual(providedSig, expectedLegacy)) {
        strip();
        continue;
      }
      const before = await invalidatedBefore(table, value);
      if (before && nowSecs < before) {
        strip();
        continue;
      }
      reissue.push({ id, value, iat: nowSecs, idle: IDLE_SECONDS });
    }
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
    for (const { id, value, iat, idle } of reissue) {
      const remainingToCap = ABSOLUTE_MAX_SECONDS - (nowSecs - iat);
      if (remainingToCap <= 0) continue;
      const maxAge = Math.min(idle, remainingToCap);
      const meta = `${iat}.${idle}`;
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
