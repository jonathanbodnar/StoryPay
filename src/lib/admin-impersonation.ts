/**
 * The "admin is viewing this venue" cookie.
 *
 * It used to be a plain `admin_impersonating=1`, which a venue could set in its
 * own browser to get past suspension, close the mandatory card step, and hide
 * its activity from analytics. Now the value is signed by the server and bound
 * to the venue being viewed, so only the impersonation routes can issue it.
 * A cookie from before this change (plain "1") simply reads as not impersonating.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const IMPERSONATION_COOKIE = 'admin_impersonating';

/** Matches the cookie's own max age (4 hours). */
const MAX_AGE_SECONDS = 60 * 60 * 4;

function secret(): string | null {
  return process.env.NEXTAUTH_SECRET ?? process.env.ADMIN_SECRET ?? process.env.LEAD_WEBHOOK_SECRET ?? null;
}

function sign(venueId: string, iat: number, key: string): string {
  return createHmac('sha256', key)
    .update(`${IMPERSONATION_COOKIE}:${venueId}:${iat}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** The cookie value for an admin viewing `venueId`. */
export function impersonationCookieValue(venueId: string): string {
  const key = secret();
  if (!key) throw new Error('No signing secret configured for admin impersonation.');
  const iat = Math.floor(Date.now() / 1000);
  return `v1.${iat}.${sign(venueId, iat, key)}`;
}

/** True only for a cookie this server issued for this venue, within its lifetime. */
export function isAdminImpersonating(value: string | null | undefined, venueId: string | null | undefined): boolean {
  const key = secret();
  if (!key || !value || !venueId) return false;
  const [version, iatRaw, sig, extra] = value.split('.');
  if (version !== 'v1' || !iatRaw || !sig || extra !== undefined) return false;
  const iat = Number(iatRaw);
  if (!Number.isFinite(iat)) return false;
  const age = Math.floor(Date.now() / 1000) - iat;
  if (age < 0 || age > MAX_AGE_SECONDS) return false;
  const expected = sign(venueId, iat, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
