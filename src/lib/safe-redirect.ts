/**
 * Safe-redirect helpers — defense against open-redirect attacks.
 *
 * Every server-side `NextResponse.redirect(...)` MUST funnel through this
 * file. We do two things to prevent open redirects:
 *
 * 1. The redirect host is sourced ONLY from the environment, never from
 *    request headers. Building the redirect URL from `Host` /
 *    `X-Forwarded-Host` lets an attacker craft a request with a spoofed
 *    header so the server replies `Location: https://evil.com/<path>`,
 *    which is a textbook open-redirect / social engineering payload.
 *
 * 2. The redirect path is validated to be a simple absolute path on our
 *    own origin — no protocol-relative (`//evil.com/x`), no fully-qualified
 *    URLs (`https://evil.com/x`), no backslash tricks, and no embedded
 *    `\r` / `\n` (header-splitting).
 *
 * Anything that fails validation falls back to `/` so we never emit an
 * untrusted Location header.
 */

import { NextResponse } from 'next/server';

/**
 * Hardcoded production origin. Used as the absolute last-resort fallback
 * if NEXT_PUBLIC_APP_URL is somehow unset in production. Update this
 * constant if the canonical app domain ever changes.
 */
const PRODUCTION_ORIGIN = 'https://app.storyvenue.com';

/** Allowlist of origins we'll ever redirect to. Compared case-insensitively. */
const ALLOWED_ORIGINS: readonly string[] = [
  'https://app.storyvenue.com',
  'https://storyvenue.com',
  'https://www.storyvenue.com',
  'https://storypay.io',
  'https://www.storypay.io',
];

/**
 * Resolve our trusted app origin. Order:
 *   1. NEXT_PUBLIC_APP_URL env var, if it normalizes to an allowed origin
 *   2. NEXT_PUBLIC_SITE_URL env var, same check
 *   3. PRODUCTION_ORIGIN constant
 *
 * The function intentionally accepts NO arguments — there is no input
 * channel through which an attacker can influence the result.
 */
export function getTrustedAppOrigin(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const normalized = normalizeOrigin(c);
    if (normalized && ALLOWED_ORIGINS.includes(normalized.toLowerCase())) {
      return normalized;
    }
  }
  return PRODUCTION_ORIGIN;
}

/**
 * Strip trailing slashes / paths from a URL, leaving just `https://host`.
 * Returns null if the input isn't a parseable absolute URL.
 */
function normalizeOrigin(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * Validate that `path` is a plain absolute path on our own origin. Rejects:
 *   - Empty string / non-strings
 *   - Anything not starting with `/`
 *   - Protocol-relative URLs (`//evil.com/x`)
 *   - Backslash-prefixed (`/\evil.com/x` → some clients normalize to `//`)
 *   - URLs with embedded `\r` / `\n` (HTTP header injection)
 *   - Anything with an explicit scheme (`https://...`)
 *
 * Returns a sanitized path on success or `/` on failure.
 */
export function sanitizeRedirectPath(path: string | null | undefined): string {
  if (typeof path !== 'string' || path.length === 0) return '/';
  // Reject if it doesn't start with exactly one '/'
  if (!path.startsWith('/'))                          return '/';
  if (path.startsWith('//'))                          return '/';
  if (path.startsWith('/\\'))                         return '/';
  // Reject control chars (CR / LF / NUL) anywhere in the path
  if (/[\r\n\0]/.test(path))                          return '/';
  // Reject anything that looks like a fully-qualified URL embedded in the path
  if (/^\/[a-z][a-z0-9+.-]*:\/\//i.test(path))        return '/';
  return path;
}

/**
 * Build a redirect URL on our trusted origin. `path` is sanitized; any
 * suspicious value is rewritten to `/` so we never produce an off-host
 * Location header.
 */
export function buildSafeRedirectUrl(path: string | null | undefined): string {
  const safePath = sanitizeRedirectPath(path);
  const origin   = getTrustedAppOrigin();
  return `${origin}${safePath}`;
}

/**
 * Drop-in replacement for `NextResponse.redirect(\`${base}${path}\`)`.
 * The base is always our trusted origin; the path is sanitized.
 */
export function safeRedirect(path: string | null | undefined): NextResponse {
  return NextResponse.redirect(buildSafeRedirectUrl(path));
}
