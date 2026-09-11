import crypto from 'crypto';

/**
 * Public minisite writes (guestbook posts, RSVP name lookups) originate on the
 * weddingdirectory app (storyvenue.com) and are proxied to StoryPay, HMAC-signed
 * with the shared lead-webhook secret over the raw JSON body. This mirrors the
 * existing /api/public/leads trust boundary — reuse the same secret so no new
 * environment variable is required in either deployment.
 */
const SECRET = process.env.LEAD_WEBHOOK_SECRET || '';

export function verifyMinisiteSignature(rawBody: string, signature: string | null): boolean {
  if (!SECRET || !signature) return false;
  const expected = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
