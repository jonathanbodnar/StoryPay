/**
 * StoryPay pause switch. SERVER-ONLY — reads process.env directly, so do not
 * import this into client components. Clients get the computed `paused` flag
 * from /api/lunarpay/active and /api/lunarpay/status instead.
 *
 * StoryPay is temporarily paused while we replace the payments integration.
 * During the pause, venues see a "big update, stay tuned" message instead of
 * the signup flow — except for exempt venues, which keep working so the
 * replacement integration can be tested against real data.
 *
 * Two switches, both failing closed:
 *   STORYPAY_PAUSED        master switch. Anything other than the exact
 *                          string 'false' counts as paused.
 *   STORYPAY_EXEMPT_SLUGS  comma-separated venue slugs that stay fully
 *                          working. Defaults to the demo venue.
 *
 * Un-pausing is therefore either STORYPAY_PAUSED=false (everyone) or adding a
 * slug to STORYPAY_EXEMPT_SLUGS (one venue), with no code change.
 */

const DEFAULT_EXEMPT_SLUGS = 'demo-venue';

/** True when the pause is in force at all (before any per-venue exemption). */
export function storyPayPauseEnabled(): boolean {
  return process.env.STORYPAY_PAUSED !== 'false';
}

export function storyPayExemptSlugs(): string[] {
  const raw = process.env.STORYPAY_EXEMPT_SLUGS ?? DEFAULT_EXEMPT_SLUGS;
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isStoryPayExemptSlug(slug: string | null | undefined): boolean {
  if (!slug) return false;
  return storyPayExemptSlugs().includes(slug.toLowerCase());
}

/**
 * Should this venue see the paused StoryPay experience?
 * Active merchants are unaffected by this flag — it only gates the signup and
 * onboarding flow, never an already-approved merchant account.
 */
export function isStoryPayPaused(slug: string | null | undefined): boolean {
  return storyPayPauseEnabled() && !isStoryPayExemptSlug(slug);
}
