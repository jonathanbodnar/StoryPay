import { createHmac, timingSafeEqual } from 'crypto';

const PREFIX = 'm1';

function secret(): string {
  return (
    process.env.MARKETING_EMAIL_TOKEN_SECRET ||
    process.env.MARKETING_CRON_SECRET ||
    process.env.CRON_SECRET ||
    ''
  );
}

/** Signed payload: venueId|leadId|exp (unix seconds) */
export function signMarketingUnsubscribeToken(venueId: string, leadId: string, ttlSeconds = 60 * 60 * 24 * 365): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${venueId}|${leadId}|${exp}`;
  const sig = createHmac('sha256', secret() || 'dev-unsafe').update(payload).digest('base64url');
  return `${PREFIX}.${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`;
}

const PREFIX_OPEN = 'mo1';

/** Signed open-tracking token for marketing_campaign_recipients.id (pixel URL). */
export function signMarketingOpenToken(recipientId: string, ttlSeconds = 60 * 60 * 24 * 365): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `open|${recipientId}|${exp}`;
  const sig = createHmac('sha256', secret() || 'dev-unsafe').update(payload).digest('base64url');
  return `${PREFIX_OPEN}.${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`;
}

export function verifyMarketingOpenToken(token: string): { recipientId: string } | null {
  if (!secret() && process.env.NODE_ENV === 'production') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX_OPEN) return null;
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    const sig = parts[2];
    const expected = createHmac('sha256', secret() || 'dev-unsafe').update(payload).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const [kind, recipientId, expStr] = payload.split('|');
    if (kind !== 'open' || !recipientId) return null;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
    return { recipientId };
  } catch {
    return null;
  }
}

export function verifyMarketingUnsubscribeToken(token: string): { venueId: string; leadId: string } | null {
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
    const [venueId, leadId, expStr] = payload.split('|');
    const exp = Number(expStr);
    if (!venueId || !leadId || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
    return { venueId, leadId };
  } catch {
    return null;
  }
}
