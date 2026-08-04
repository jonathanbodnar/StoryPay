import jwt from 'jsonwebtoken';
import { secureCompare } from './secure-compare';

/**
 * Master super-admin session token.
 *
 * Previously the `admin_token` cookie stored the raw `ADMIN_SECRET`, so a single
 * cookie leak (XSS, theft, logs) handed an attacker the master secret itself —
 * which also signs support JWTs, venue password-reset tokens and the venue_id
 * session cookies. Now the cookie holds a short-lived JWT *signed by* that
 * secret; the raw secret never leaves the server.
 *
 * The signing key stays `ADMIN_SECRET` (same key the support-agent JWT and the
 * reset-token signer already use), so no new env var is required.
 */

const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days, matches the cookie maxAge

function secret(): string {
  const s = process.env.ADMIN_SECRET;
  if (!s) throw new Error('ADMIN_SECRET is not set');
  return s;
}

/** Issue a signed master super-admin session token for the `admin_token` cookie. */
export function issueMasterAdminToken(): string {
  return jwt.sign({ role: 'master' }, secret(), { algorithm: 'HS256', expiresIn: TTL_SECONDS });
}

/** True iff `token` is a valid, unexpired master super-admin session token. */
export function verifyMasterAdminToken(token: string | undefined | null): boolean {
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, secret(), { algorithms: ['HS256'] }) as { role?: string };
    return decoded?.role === 'master';
  } catch {
    return false;
  }
}

/**
 * Constant-time comparison of a raw bearer token against ADMIN_SECRET. Used only
 * by server-to-server / CI endpoints that authenticate with the raw secret in an
 * `Authorization: Bearer` header (NOT the browser cookie), e.g. help embeddings
 * seeding.
 */
export function isAdminSecretBearer(token: string | undefined | null): boolean {
  if (!token) return false;
  return secureCompare(token, process.env.ADMIN_SECRET);
}
