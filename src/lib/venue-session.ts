import crypto from 'crypto';
import type { NextResponse } from 'next/server';

/**
 * HMAC-signed session cookies for the multi-tenant boundary.
 *
 * `venue_id` (which tenant) and `member_id` (which team member / role) decide
 * what data a request may touch. They used to be plaintext httpOnly cookies,
 * which meant any authenticated user could edit their own cookie and read or
 * write another venue's data — a cross-tenant IDOR. We now issue a companion
 * `<name>_sig` cookie holding HMAC-SHA256(secret, "<name>=<value>"). src/proxy.ts
 * verifies the pair on every request and strips the id cookie before it reaches
 * any handler if the signature is missing or wrong.
 *
 * The signature is bound to the cookie NAME so a venue signature cannot be
 * replayed in the member slot (or vice-versa).
 *
 * The verification side (proxy) uses Web Crypto so it runs on any runtime; both
 * sides produce identical HMAC-SHA256/base64url output, so they interoperate.
 */

export const SIGNED_COOKIE_NAMES = ['venue_id', 'member_id'] as const;
export type SignedCookieName = (typeof SIGNED_COOKIE_NAMES)[number];

export function sigCookieName(name: string): string {
  return `${name}_sig`;
}

function getSecret(): string {
  const secret =
    process.env.NEXTAUTH_SECRET ??
    process.env.ADMIN_SECRET ??
    process.env.LEAD_WEBHOOK_SECRET;
  if (!secret) {
    // Fail loudly on the signing side — mirrors twofa-pending.ts / the venue
    // forgot-password flow. A missing secret must never silently issue
    // unverifiable sessions.
    throw new Error('No signing secret configured (NEXTAUTH_SECRET / ADMIN_SECRET).');
  }
  return secret;
}

/** HMAC-SHA256(secret, "<name>=<value>") as base64url (no padding). */
export function signSessionValue(name: string, value: string): string {
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

/** Set an id cookie AND its signature cookie with the same options. */
export function setSignedCookie(
  res: NextResponse,
  name: SignedCookieName,
  value: string,
  options: CookieOptions,
): void {
  res.cookies.set(name, value, options);
  res.cookies.set(sigCookieName(name), signSessionValue(name, value), options);
}

/** Clear an id cookie AND its signature cookie. */
export function clearSignedCookie(
  res: NextResponse,
  name: SignedCookieName,
  options?: CookieOptions,
): void {
  const opts: CookieOptions = { ...(options ?? {}), maxAge: 0 };
  res.cookies.set(name, '', opts);
  res.cookies.set(sigCookieName(name), '', opts);
}
