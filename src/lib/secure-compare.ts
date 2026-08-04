import crypto from 'crypto';

/**
 * Constant-time string comparison for secrets / bearer tokens.
 *
 * A plain `a === b` short-circuits on the first differing byte, which leaks
 * how many leading characters matched via response timing. For high-entropy
 * secrets (e.g. ADMIN_SECRET) a remote timing attack is impractical, but this
 * removes the class of bug entirely and costs nothing.
 *
 * Both inputs are hashed to a fixed 32-byte digest first so the comparison is
 * length-independent (no early-return on length mismatch, which would itself
 * be a timing signal).
 */
export function secureCompare(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
