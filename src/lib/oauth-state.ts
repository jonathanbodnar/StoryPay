/**
 * Signed `state` for connect flows that attach an outside account to a venue
 * (Google Calendar, QuickBooks / FreshBooks). Venue IDs are public (they're in
 * every pricing-guide link), so a raw venue ID in `state` let anyone run the
 * flow with their own account and attach it to another venue: that venue's
 * bookings or payments then synced to the stranger's account. The state is
 * signed by the server, names its flow, and expires; the callbacks also
 * require the same signed-in venue. (The GoHighLevel flow has its own,
 * lib/ghl-oauth-state.ts.)
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** A connect flow has to finish within this long. */
const STATE_TTL_MS = 60 * 60 * 1000;

function stateSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.ADMIN_SECRET ?? process.env.LEAD_WEBHOOK_SECRET;
  if (!secret) throw new Error('No signing secret configured for connect flows.');
  return secret;
}

const b64url = (buf: Buffer) => buf.toString('base64url');
const mac = (flow: string, payload: string) => b64url(createHmac('sha256', stateSecret()).update(`oauth:${flow}:${payload}`).digest());

export function signOAuthState(flow: string, venueId: string, extra: Record<string, string> = {}): string {
  const payload = b64url(Buffer.from(JSON.stringify({ v: venueId, t: Date.now(), x: extra })));
  return `${payload}.${mac(flow, payload)}`;
}

/** The venue (and extras) a state was issued for, or null when it's forged, from another flow, malformed or expired. */
export function verifyOAuthState(flow: string, state: string | null | undefined): { venueId: string; extra: Record<string, string> } | null {
  if (!state) return null;
  const [payload, sig, more] = state.split('.');
  if (!payload || !sig || more !== undefined) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(mac(flow, payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { v?: unknown; t?: unknown; x?: unknown };
    if (typeof json.v !== 'string' || !json.v || typeof json.t !== 'number') return null;
    if (Date.now() - json.t > STATE_TTL_MS || json.t > Date.now() + 60_000) return null;
    const extra = json.x && typeof json.x === 'object' ? (json.x as Record<string, string>) : {};
    return { venueId: json.v, extra };
  } catch {
    return null;
  }
}
