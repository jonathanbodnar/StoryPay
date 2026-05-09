/**
 * Centralised feature flags. Each flag defaults to OFF and is enabled by
 * setting the corresponding env var to "true" (string).
 *
 * Server-only — never imported into client components. Client UIs that need
 * to know about a flag should call an API endpoint that reads it.
 */

/**
 * TOTP-based two-factor authentication for venue owners.
 *
 * When OFF (default):
 *  - The profile page hides the 2FA section.
 *  - All /api/auth/2fa/* endpoints return 404.
 *  - Sign-in never inspects totp_enabled_at — every login is single-factor.
 *
 * Migration 125 (the totp_* columns) can be run regardless of this flag —
 * the columns simply stay null until someone enrols.
 */
export const TWOFA_ENABLED = process.env.TWOFA_ENABLED === 'true';
