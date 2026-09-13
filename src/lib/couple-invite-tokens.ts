import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Signed tokens for the couple-side "website invite" one-click unsubscribe flow.
 *
 * Mirrors src/lib/marketing-email-tokens.ts but is scoped to a couple's wedding
 * (couple_wedding_id) + the recipient email, rather than venue/lead. The token is
 * embedded in the List-Unsubscribe URL of every website-invite email so a guest
 * can opt out with one click; verifying it lets the public endpoint record the
 * suppression without any session.
 */

const PREFIX = 'cw1';

function secret(): string {
  return (
    process.env.MARKETING_EMAIL_TOKEN_SECRET ||
    process.env.MARKETING_CRON_SECRET ||
    process.env.CRON_SECRET ||
    ''
  );
}

/** Signed payload: coupleWeddingId|exp(unix seconds)|urlEncodedEmail */
export function signCoupleUnsubscribeToken(
  coupleWeddingId: string,
  email: string,
  ttlSeconds = 60 * 60 * 24 * 365,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${coupleWeddingId}|${exp}|${encodeURIComponent(email.trim().toLowerCase())}`;
  const sig = createHmac('sha256', secret() || 'dev-unsafe').update(payload).digest('base64url');
  return `${PREFIX}.${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`;
}

export function verifyCoupleUnsubscribeToken(
  token: string,
): { coupleWeddingId: string; email: string } | null {
  if (!secret() && process.env.NODE_ENV === 'production') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    const sig = parts[2];
    const expected = createHmac('sha256', secret() || 'dev-unsafe').update(payload).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const [coupleWeddingId, expStr, emailEnc] = payload.split('|');
    const exp = Number(expStr);
    const email = emailEnc ? decodeURIComponent(emailEnc) : '';
    if (!coupleWeddingId || !email || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { coupleWeddingId, email };
  } catch {
    return null;
  }
}
