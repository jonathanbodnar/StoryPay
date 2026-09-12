/**
 * Symmetric encryption for third-party tokens at rest.
 *
 * Used to protect OAuth access/refresh tokens (e.g. a couple's Pinterest tokens)
 * stored in the database. Encryption uses AES-256-GCM with a key derived from
 * the TOKEN_ENCRYPTION_KEY env var.
 *
 * Backwards/forwards tolerant so the app never hard-fails on a missing key:
 *   - encryptToken(): if no key is configured, stores a `plain:` fallback so we
 *     match the repo's existing plaintext-token convention until a key is set.
 *   - decryptToken(): understands `enc:v1:` (encrypted), `plain:` (explicit
 *     plaintext), and bare legacy plaintext.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ENC_PREFIX = 'enc:v1:';
const PLAIN_PREFIX = 'plain:';

function getKey(): Buffer | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw || !raw.trim()) return null;
  // Derive a stable 32-byte key from whatever the user provides (hex, base64, or
  // an arbitrary passphrase) so key formatting never breaks decryption.
  return createHash('sha256').update(raw.trim()).digest();
}

/** Encrypt a token string for storage. Returns a self-describing string. */
export function encryptToken(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined) return null;
  const key = getKey();
  if (!key) return `${PLAIN_PREFIX}${plain}`;

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${Buffer.concat([iv, tag, ct]).toString('base64')}`;
}

/** Decrypt a stored token string. Tolerant of plaintext + legacy values. */
export function decryptToken(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined) return null;
  if (stored.startsWith(PLAIN_PREFIX)) return stored.slice(PLAIN_PREFIX.length);
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy bare plaintext

  const key = getKey();
  if (!key) return null; // was encrypted but key is now missing — cannot recover
  try {
    const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
