import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Signed token for the gated "Send me my guide" link (/get-guide/[token]).
 *
 * Binds one lead at one venue, so the public page can prefill that couple's
 * details and record their opt-in without a session. Same construction and
 * secret source as src/lib/couple-invite-tokens.ts, with two differences:
 *   - the HMAC input is purpose-prefixed (`gi1|…`), so a token minted for any
 *     other feature can never verify here;
 *   - it FAILS CLOSED: with no secret configured, no token is issued (the caller
 *     then keeps today's email-guide behaviour) and none verifies.
 *
 * Pure: crypto only, no I/O.
 */

const PREFIX = 'gi1';
/** The link keeps working for a while — couples come back to old emails. */
const TTL_SECONDS = 60 * 60 * 24 * 90;

function secret(): string {
  return (
    process.env.MARKETING_EMAIL_TOKEN_SECRET ||
    process.env.MARKETING_CRON_SECRET ||
    process.env.CRON_SECRET ||
    ''
  );
}

const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(`${PREFIX}|${payload}`).digest('base64url');
}

/** A token for this lead, or null when no signing secret is configured. */
export function signGuideInviteToken(leadId: string, venueId: string, now: Date = new Date()): string | null {
  const key = secret();
  if (!key || !UUID_RE.test(leadId) || !UUID_RE.test(venueId)) return null;
  const exp = Math.floor(now.getTime() / 1000) + TTL_SECONDS;
  const payload = `${leadId}|${venueId}|${exp}`;
  return `${PREFIX}.${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(payload, key)}`;
}

/** The lead and venue a valid, unexpired token was issued for; otherwise null. */
export function verifyGuideInviteToken(
  token: string | null | undefined,
  now: Date = new Date(),
): { leadId: string; venueId: string } | null {
  const key = secret();
  if (!key || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    const a = Buffer.from(parts[2]);
    const b = Buffer.from(sign(payload, key));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const [leadId, venueId, expStr] = payload.split('|');
    const exp = Number(expStr);
    if (!UUID_RE.test(leadId ?? '') || !UUID_RE.test(venueId ?? '')) return null;
    if (!Number.isFinite(exp) || exp < Math.floor(now.getTime() / 1000)) return null;
    return { leadId, venueId };
  } catch {
    return null;
  }
}
