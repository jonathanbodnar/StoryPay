/**
 * The master admin's emailed sign-in code is tied to the browser that entered
 * the password. SERVER-ONLY.
 *
 * The password step sets a short-lived signed cookie naming the code's row;
 * /api/admin/auth/verify-otp accepts a code only together with that cookie,
 * so nobody without the password can even try a code. Each code allows
 * MAX_WRONG_ATTEMPTS wrong guesses and is then cancelled.
 */

import crypto from 'crypto';

export const ADMIN_OTP_PENDING_COOKIE = 'admin_otp_pending';
export const MAX_WRONG_ATTEMPTS = 5;

function sign(tokenId: string): string {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error('ADMIN_SECRET is not set');
  return crypto.createHmac('sha256', secret).update(`admin-otp-pending:${tokenId}`).digest('base64url');
}

/** Cookie value for the code row `tokenId`. */
export function pendingCookieValue(tokenId: string): string {
  return `${tokenId}.${sign(tokenId)}`;
}

/** The code row this browser may answer for, or null when the cookie is missing or forged. */
export function tokenIdFromPendingCookie(value: string | null | undefined): string | null {
  const v = String(value ?? '');
  const dot = v.lastIndexOf('.');
  if (dot <= 0) return null;
  const tokenId = v.slice(0, dot);
  const given = Buffer.from(v.slice(dot + 1));
  const expected = Buffer.from(sign(tokenId));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  return tokenId;
}

// One server, so an in-memory count is enough; a restart only resets counts
// for codes that still need the cookie to be tried at all.
const wrongAttempts = new Map<string, number>();

/** Count a wrong code; returns how many wrong tries this code has had. */
export function recordWrongAttempt(tokenId: string): number {
  const n = (wrongAttempts.get(tokenId) ?? 0) + 1;
  wrongAttempts.set(tokenId, n);
  if (wrongAttempts.size > 1000) {
    const first = wrongAttempts.keys().next().value;
    if (first !== undefined) wrongAttempts.delete(first);
  }
  return n;
}

export function clearAttempts(tokenId: string): void {
  wrongAttempts.delete(tokenId);
}

/** Constant-time comparison of two short codes. */
export function codesMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
