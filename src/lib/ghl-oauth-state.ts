/**
 * Signed `state` for the GoHighLevel connect flow (api/messaging/connect →
 * GHL → api/messaging/callback).
 *
 * The state used to be the raw venue ID, and the callback saved the CRM tokens
 * onto whatever venue the state named. Venue IDs are public (they're in every
 * pricing-guide link), so anyone could run the flow with their own CRM account
 * and attach it to another venue, redirecting that venue's texts. Now the state
 * is signed by the server and expires, and the callback also requires the same
 * signed-in venue (see the callback route).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** A connect flow has to finish within this long. */
const STATE_TTL_MS = 60 * 60 * 1000;

function stateSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.ADMIN_SECRET ?? process.env.LEAD_WEBHOOK_SECRET;
  if (!secret) throw new Error('No signing secret configured for the CRM connect flow.');
  return secret;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function signGhlOAuthState(venueId: string): string {
  const payload = b64url(Buffer.from(JSON.stringify({ v: venueId, t: Date.now() })));
  const sig = b64url(createHmac('sha256', stateSecret()).update(`ghl-oauth:${payload}`).digest());
  return `${payload}.${sig}`;
}

/** The venue ID the state was issued for, or null when it's forged, malformed or expired. */
export function verifyGhlOAuthState(state: string | null | undefined): string | null {
  if (!state) return null;
  const [payload, sig, extra] = state.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const expected = b64url(createHmac('sha256', stateSecret()).update(`ghl-oauth:${payload}`).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as {
      v?: unknown;
      t?: unknown;
    };
    if (typeof json.v !== 'string' || !json.v || typeof json.t !== 'number') return null;
    if (Date.now() - json.t > STATE_TTL_MS) return null;
    return json.v;
  } catch {
    return null;
  }
}
