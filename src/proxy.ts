import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const APP_HOSTS = new Set(['app.storyvenue.com']);

/**
 * Tenant-session cookies whose signatures we verify on every request.
 * See src/lib/venue-session.ts for how they are issued.
 */
const SIGNED_COOKIES: Array<{ id: string; sig: string }> = [
  { id: 'venue_id', sig: 'venue_id_sig' },
  { id: 'member_id', sig: 'member_id_sig' },
];

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

export async function proxy(request: NextRequest) {
  const host = request.headers.get('host')?.toLowerCase() ?? '';
  const hostname = host.split(':')[0];

  if (APP_HOSTS.has(hostname) && request.nextUrl.pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url, 307);
  }

  const secret = getSecret();
  // If no signing secret is configured we cannot verify. Fail OPEN so a
  // misconfiguration can't lock every tenant out — the signing side fails
  // loudly on its own, so this branch should never hit in production.
  if (!secret) return NextResponse.next();

  const toStrip = new Set<string>();
  for (const { id, sig } of SIGNED_COOKIES) {
    const value = request.cookies.get(id)?.value;
    if (!value) continue; // no id cookie → nothing to trust, nothing to strip
    const provided = request.cookies.get(sig)?.value;
    const expected = await hmacBase64Url(secret, `${id}=${value}`);
    if (!provided || !safeEqual(provided, expected)) {
      // Missing signature (legacy/forged) or wrong signature (tampered).
      toStrip.add(id);
      toStrip.add(sig);
    }
  }

  if (toStrip.size === 0) return NextResponse.next();

  // Rebuild the forwarded Cookie header without the untrusted cookies so that
  // BOTH getVenueId() and the routes that read the cookie directly see an
  // unauthenticated request instead of trusting a forged tenant id. We do not
  // clear the cookie on the response — that would collide with auth routes that
  // legitimately set a fresh signed cookie in the same round-trip. The stale
  // cookie is harmless (stripped every request) until the next login overwrites
  // it with a properly signed value.
  const remaining = request.cookies.getAll().filter((c) => !toStrip.has(c.name));
  const requestHeaders = new Headers(request.headers);
  if (remaining.length > 0) {
    requestHeaders.set('cookie', remaining.map((c) => `${c.name}=${c.value}`).join('; '));
  } else {
    requestHeaders.delete('cookie');
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
