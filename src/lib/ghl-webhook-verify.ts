import crypto from 'crypto';

/**
 * Verifies GoHighLevel webhook signatures.
 *
 * GHL signs every webhook body with its own private key and sends the
 * signature in one (or both, during their migration window) of two headers:
 *
 *   X-GHL-Signature  (Ed25519, current)  — prefer this when present.
 *   X-WH-Signature   (RSA-SHA256, legacy) — GHL is deprecating this on
 *                                           2026-09-01; kept as a fallback
 *                                           for the transition period.
 *
 * Both public keys below are published by GHL themselves (not secrets) at
 * https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/
 * — pulled 2026-08-04. They verify the raw request body bytes, so callers
 * MUST pass the exact text received (before any JSON.parse/re-serialize),
 * or the signature will never match even for a genuine GHL webhook.
 */

const GHL_ED25519_PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----\n' +
  'MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=\n' +
  '-----END PUBLIC KEY-----';

const GHL_LEGACY_RSA_PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----\n' +
  'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAokvo/r9tVgcfZ5DysOSC\n' +
  'Frm602qYV0MaAiNnX9O8KxMbiyRKWeL9JpCpVpt4XHIcBOK4u3cLSqJGOLaPuXw6\n' +
  'dO0t6Q/ZVdAV5Phz+ZtzPL16iCGeK9po6D6JHBpbi989mmzMryUnQJezlYJ3DVfBc\n' +
  'sedpinheNnyYeFXolrJvcsjDtfAeRx5ByHQmTnSdFUzuAnC9/GepgLT9SM4nCpvux\n' +
  'mZMxrJt5Rw+VUaQ9B8JSvbMPpez4peKaJPZHBbU3OdeCVx5klVXXZQGNHOs8gF3kv\n' +
  'oV5rTnXV0IknLBXlcKKAQLZcY/Q9rG6Ifi9c+5vqlvHPCUJFT5XUGG5RKgOKUJ062\n' +
  'fRtN+rLYZUV+BjafxQauvC8wSWeYja63VSUruvmNj8xkx2zE/Juc+yjLjTXpIocma\n' +
  'iFeAO6fUtNjDeFVkhf5LNb59vECyrHD2SQIrhgXpO4Q3dVNA5rw576PwTzNh/AMfH\n' +
  'KIjE4xQA1SZuYJmNnmVZLIZBlQAF9Ntd03rfadZ+yDiOXCCs9FkHibELhCHULgCsn\n' +
  'uDJHcrGNd5/Ddm5hxGQ0ASitgHeMZ0kcIOwKDOzOU53lDza6/Y09T7sYJPQe7z0cv\n' +
  'j7aE4B+Ax1ZoZGPzpJlZtGXCsu9aTEGEnKzmsFqwcSsnw3JB31IGKAykT1hhTiaCe\n' +
  'IY/OwwwNUY2yvcCAwEAAQ==\n' +
  '-----END PUBLIC KEY-----';

export type GhlWebhookVerification =
  | { status: 'valid'; header: 'x-ghl-signature' | 'x-wh-signature' }
  | { status: 'invalid'; header: 'x-ghl-signature' | 'x-wh-signature'; reason: string }
  | { status: 'missing' };

function verifyEd25519(rawBody: string, signatureBase64: string): boolean {
  try {
    const payloadBuffer = Buffer.from(rawBody, 'utf8');
    const signatureBuffer = Buffer.from(signatureBase64, 'base64');
    return crypto.verify(null, payloadBuffer, GHL_ED25519_PUBLIC_KEY, signatureBuffer);
  } catch {
    return false;
  }
}

function verifyLegacyRsa(rawBody: string, signatureBase64: string): boolean {
  try {
    const verifier = crypto.createVerify('SHA256');
    verifier.update(rawBody);
    return verifier.verify(GHL_LEGACY_RSA_PUBLIC_KEY, signatureBase64, 'base64');
  } catch {
    return false;
  }
}

/**
 * Verifies a GHL webhook's signature against the exact raw request body.
 * Prefers X-GHL-Signature (Ed25519); falls back to X-WH-Signature (legacy
 * RSA) only if the current header isn't present, matching GHL's own
 * documented transition-period recommendation.
 */
export function verifyGhlWebhookSignature(
  rawBody: string,
  headers: Headers,
): GhlWebhookVerification {
  const ghlSig = headers.get('x-ghl-signature');
  if (ghlSig) {
    return verifyEd25519(rawBody, ghlSig)
      ? { status: 'valid', header: 'x-ghl-signature' }
      : { status: 'invalid', header: 'x-ghl-signature', reason: 'Ed25519 verification failed' };
  }

  const legacySig = headers.get('x-wh-signature');
  if (legacySig) {
    return verifyLegacyRsa(rawBody, legacySig)
      ? { status: 'valid', header: 'x-wh-signature' }
      : { status: 'invalid', header: 'x-wh-signature', reason: 'RSA-SHA256 verification failed' };
  }

  return { status: 'missing' };
}
