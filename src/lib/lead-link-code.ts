import { randomInt } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Lead Link short codes live under storyvenue.com/v/<code>. Keeping them in a
 * dedicated namespace (never the root) means no venue can ever squat a prime
 * top-level path (storyvenue.com/links, /pricing, …) — those stay reserved for
 * StoryVenue itself.
 *
 * Alphabet: lowercase letters + digits with the look-alikes removed
 * (0/o, 1/i/l). That keeps codes unambiguous when spoken/typed and effectively
 * case-insensitive. 31 symbols ^ 6 chars ≈ 887M combinations — non-enumerable
 * (nobody can guess another venue's link) and collision-proof at our scale.
 */
export const LEAD_LINK_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
export const LEAD_LINK_CODE_LENGTH = 6;

/** Anything a valid handle (random code OR custom vanity) must match. */
export const LEAD_LINK_HANDLE_RE = /^[a-z0-9-]{1,80}$/;

/**
 * Vanity handles a venue may not claim under /v/. Kept intentionally small —
 * the namespace already protects the root, so this only blocks a handful of
 * confusing values and anything we might mount as a real /v/ sub-route later.
 */
export const LEAD_LINK_RESERVED = new Set([
  'v', 'venue', 'venues', 'api', 'admin', 'dashboard', 'app',
  'new', 'edit', 'settings', 'login', 'logout', 'signup',
]);

/** Generate a single random short code (no uniqueness guarantee). */
export function generateLeadLinkCode(length: number = LEAD_LINK_CODE_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += LEAD_LINK_CODE_ALPHABET[randomInt(LEAD_LINK_CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Generate a random short code that is not already used by another venue.
 * Retries on the (astronomically rare) collision, widening the code length as a
 * last resort so this can never loop forever.
 */
export async function generateUniqueLeadLinkCode(attempts = 8): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const length = LEAD_LINK_CODE_LENGTH + Math.floor(i / 4); // widen after a few misses
    const code = generateLeadLinkCode(length);
    const { data } = await supabaseAdmin
      .from('venues')
      .select('id')
      .ilike('lead_link_slug', code)
      .limit(1);
    if (!data || data.length === 0) return code;
  }
  // Fallback: a longer code is overwhelmingly likely to be free.
  return generateLeadLinkCode(LEAD_LINK_CODE_LENGTH + 4);
}
