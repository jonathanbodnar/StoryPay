import crypto from 'crypto';
import type { NextResponse } from 'next/server';

/**
 * HMAC-signed, time-bounded session cookies for the multi-tenant boundary.
 *
 * `venue_id` (which tenant) and `member_id` (which team member / role) decide
 * what data a request may touch. The cookie VALUE stays the raw UUID so every
 * handler that reads `venue_id` directly keeps working. Trust and lifetime are
 * carried in two companions:
 *
 *   <name>_meta = "<iat>.<idle>"   — issue time (unix secs) + idle window (secs)
 *   <name>_sig  = HMAC-SHA256(secret, "<name>=<value>.<meta>")   base64url
 *
 * src/proxy.ts verifies the pair on every request and strips the id cookie
 * before it reaches any handler when the signature is missing/wrong, the
 * absolute cap is exceeded, or the session has been revoked. The signature is
 * bound to the cookie NAME so a venue signature cannot be replayed in the
 * member slot (or vice-versa), and to the META so iat/idle cannot be forged.
 *
 * Lifetime policy (industry-aligned):
 *   - Absolute maximum:            7 days, regardless of activity.
 *   - Idle timeout (no remember):  8 hours (sliding — refreshed by the proxy).
 *   - "Remember me":               stays signed in up to the 7-day cap.
 */

export const SIGNED_COOKIE_NAMES = ['venue_id', 'member_id'] as const;
export type SignedCookieName = (typeof SIGNED_COOKIE_NAMES)[number];

export const ABSOLUTE_MAX_SECONDS = 60 * 60 * 24 * 7; // 7-day hard cap
export const IDLE_SECONDS = 60 * 60 * 8;              // 8-hour idle (non-remember)

export function sigCookieName(name: string): string {
  return `${name}_sig`;
}

export function metaCookieName(name: string): string {
  return `${name}_meta`;
}

function getSecret(): string {
  const secret =
    process.env.NEXTAUTH_SECRET ??
    process.env.ADMIN_SECRET ??
    process.env.LEAD_WEBHOOK_SECRET;
  if (!secret) {
    // Fail loudly on the signing side — a missing secret must never silently
    // issue unverifiable sessions.
    throw new Error('No signing secret configured (NEXTAUTH_SECRET / ADMIN_SECRET).');
  }
  return secret;
}

/** HMAC-SHA256(secret, "<name>=<value>.<meta>") as base64url (no padding). */
export function signSessionValue(name: string, value: string, meta: string): string {
  return crypto
    .createHmac('sha256', Buffer.from(getSecret()))
    .update(`${name}=${value}.${meta}`)
    .digest('base64url');
}

/**
 * Legacy signature format (pre-metadata): HMAC(secret, "<name>=<value>").
 * Kept only so sessions issued before this change verify once and are silently
 * upgraded to the new format by the proxy — avoids logging every tenant out.
 */
export function signLegacyValue(name: string, value: string): string {
  return crypto
    .createHmac('sha256', Buffer.from(getSecret()))
    .update(`${name}=${value}`)
    .digest('base64url');
}

type CookieOptions = {
  path?: string;
  domain?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: boolean | 'lax' | 'strict' | 'none';
  maxAge?: number;
  expires?: Date;
};

export type SessionOptions = {
  /** "Remember me": relax the idle window to the 7-day absolute cap. */
  rememberMe?: boolean;
  /** Override issue time (unix seconds). Used when re-issuing after revocation. */
  iat?: number;
};

/**
 * Set an id cookie plus its metadata + signature companions.
 *
 * The caller's `maxAge` is intentionally ignored: lifetime is governed centrally
 * by the tiered policy above (8h idle / 7d absolute), so existing call sites need
 * no changes beyond opting a session into "remember me".
 */
export function setSignedCookie(
  res: NextResponse,
  name: SignedCookieName,
  value: string,
  options: CookieOptions,
  session: SessionOptions = {},
): void {
  const iat = session.iat ?? Math.floor(Date.now() / 1000);
  const idle = session.rememberMe ? ABSOLUTE_MAX_SECONDS : IDLE_SECONDS;
  const meta = `${iat}.${idle}`;
  const maxAge = Math.min(idle, ABSOLUTE_MAX_SECONDS);
  const opts: CookieOptions = { ...options, maxAge };

  res.cookies.set(name, value, opts);
  res.cookies.set(metaCookieName(name), meta, opts);
  res.cookies.set(sigCookieName(name), signSessionValue(name, value, meta), opts);
}

/** Clear an id cookie AND its metadata + signature companions. */
export function clearSignedCookie(
  res: NextResponse,
  name: SignedCookieName,
  options?: CookieOptions,
): void {
  const opts: CookieOptions = { ...(options ?? {}), maxAge: 0 };
  res.cookies.set(name, '', opts);
  res.cookies.set(metaCookieName(name), '', opts);
  res.cookies.set(sigCookieName(name), '', opts);
}
