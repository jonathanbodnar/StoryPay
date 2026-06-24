/**
 * Copy hygiene for AI- and Google-sourced pricing-guide text.
 *
 * Models routinely ignore negative prompt constraints, and Google business
 * descriptions are full of the same clichés, so we scrub deterministically
 * after generation: strip em/en dashes and rewrite banned words to neutral
 * substitutes. This guarantees banned terms never ship in the guide.
 */

// [pattern, replacement]. Patterns are word-boundary, case-insensitive.
const BANNED: [RegExp, string][] = [
  [/\bnestled\b/gi, 'set'],
  [/\btimeless\b/gi, 'classic'],
  [/\bmagical\b/gi, 'memorable'],
  [/\bserene\b/gi, 'peaceful'],
  [/\bdream day\b/gi, 'wedding day'],
  [/\bbackdrops?\b/gi, 'setting'],
];

/** Replace em/en dashes with a comma and tidy the surrounding whitespace. */
export function deDash(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .trim();
}

/** Rewrite banned cliché words to neutral substitutes. */
export function scrubBannedWords(s: string): string {
  let out = s;
  for (const [re, rep] of BANNED) {
    out = out.replace(re, (match) => {
      // Preserve leading capitalization of the original word.
      const r = rep;
      return /^[A-Z]/.test(match) ? r.charAt(0).toUpperCase() + r.slice(1) : r;
    });
  }
  // Collapse any double spaces introduced by replacements.
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** Full cleanup: de-dash + banned-word scrub. Safe on empty strings. */
export function cleanCopy(s: string | null | undefined): string {
  if (!s) return '';
  return scrubBannedWords(deDash(s));
}
