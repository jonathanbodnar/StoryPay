/**
 * Short-lived signed token issued after password auth succeeds but before
 * the TOTP code is verified. The token is set as an httpOnly cookie and
 * carries the venue ID + an issued-at timestamp; the verify endpoint
 * checks the HMAC and rejects anything older than 5 minutes.
 *
 * We deliberately do not set `venue_id` until 2FA passes — that's the whole
 * point of the second factor.
 */

import crypto from 'crypto';

const TTL_MS = 5 * 60 * 1000;
export const TWO_FA_PENDING_COOKIE = '2fa_pending';

function getKey(): Buffer {
  const secret =
    process.env.NEXTAUTH_SECRET ??
    process.env.ADMIN_SECRET ??
    process.env.LEAD_WEBHOOK_SECRET;
  if (!secret) {
    // Fail loudly — same posture as the venue forgot-password flow (H6).
    throw new Error('No signing secret configured (NEXTAUTH_SECRET / ADMIN_SECRET).');
  }
  return Buffer.from(secret);
}

interface PendingPayload {
  venueId:    string;
  issuedAt:   number;       // ms epoch
  rememberMe: boolean;
}

/** Sign a payload into a compact base64url cookie value. */
export function signPendingToken(payload: PendingPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', getKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Verify + decode. Returns null if signature is bad or token is expired. */
export function verifyPendingToken(token: string | undefined | null): PendingPayload | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expected = crypto.createHmac('sha256', getKey()).update(body).digest('base64url');
  // Constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as PendingPayload;
    if (typeof payload.venueId !== 'string' || typeof payload.issuedAt !== 'number') return null;
    if (Date.now() - payload.issuedAt > TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}
