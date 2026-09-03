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

export const ABSOLUTE_MAX_SECONDS = 60 * 60 * 24 * 7; // 7-day hard cap (web)
export const IDLE_SECONDS = 60 * 60 * 8;              // 8-hour idle (non-remember, web)
/**
 * Native app (Capacitor iOS/Android) sessions get a single, much longer
 * policy: log out only after 90 days of inactivity. No separate short
 * absolute cap — the idle window itself doubles as the cap, since the sole
 * ask for the native app is "log out only after 90 days idle". Set by the
 * client passing `isNative: true` to the sign-in / 2FA-verify flow.
 */
export const NATIVE_MAX_SECONDS = 60 * 60 * 24 * 90;  // 90-day idle (native)

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
  /**
   * Session originated from the Capacitor native app shell. Overrides
   * rememberMe — native gets a flat 90-day idle window/cap regardless of the
   * checkbox, since the native login form doesn't need the same distinction
   * the web form does.
   */
  isNative?: boolean;
  /** Override issue time (unix seconds). Used when re-issuing after revocation. */
  iat?: number;
};

/**
 * Set an id cookie plus its metadata + signature companions.
 *
 * The caller's `maxAge` is intentionally ignored: lifetime is governed centrally
 * by the tiered policy above (8h idle / 7d absolute for web, 90-day idle for
 * native), so existing call sites need no changes beyond opting a session into
 * "remember me" / "native".
 */
export function setSignedCookie(
  res: NextResponse,
  name: SignedCookieName,
  value: string,
  options: CookieOptions,
  session: SessionOptions = {},
): void {
  const iat = session.iat ?? Math.floor(Date.now() / 1000);
  const idle = session.isNative
    ? NATIVE_MAX_SECONDS
    : session.rememberMe
      ? ABSOLUTE_MAX_SECONDS
      : IDLE_SECONDS;
  const absCap = session.isNative ? NATIVE_MAX_SECONDS : ABSOLUTE_MAX_SECONDS;
  // 3-part meta: iat.idle.absCap. proxy.ts falls back to the legacy 7-day cap
  // when reading older 2-part metas issued before this change.
  const meta = `${iat}.${idle}.${absCap}`;
  const maxAge = Math.min(idle, absCap);
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
