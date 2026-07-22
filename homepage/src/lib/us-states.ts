/**
 * US state helpers for SEO hub pages.
 * Handles both storage formats found in the DB ("NC" and "North Carolina").
 */

export const STATE_ABBR_TO_NAME: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

const NAME_TO_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_ABBR_TO_NAME).map(([abbr, name]) => [name.toLowerCase(), abbr]),
);

/** "NC" | "North Carolina" → "North Carolina" (or the raw input if unknown). */
export function stateFullName(raw: string): string {
  const trimmed = raw.trim();
  const up = trimmed.toUpperCase();
  if (STATE_ABBR_TO_NAME[up]) return STATE_ABBR_TO_NAME[up];
  return trimmed;
}

/** "NC" | "North Carolina" → "NC" (or the raw input if unknown). */
export function stateAbbr(raw: string): string {
  const trimmed = raw.trim();
  const up = trimmed.toUpperCase();
  if (STATE_ABBR_TO_NAME[up]) return up;
  return NAME_TO_ABBR[trimmed.toLowerCase()] ?? trimmed;
}

/** "North Carolina" → "north-carolina" */
export function stateSlug(raw: string): string {
  return stateFullName(raw).toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
}

/** "north-carolina" → "North Carolina" (null if not a US state slug). */
export function stateFromSlug(slug: string): string | null {
  const target = slug.toLowerCase().replace(/-/g, ' ');
  for (const name of Object.values(STATE_ABBR_TO_NAME)) {
    if (name.toLowerCase() === target) return name;
  }
  return null;
}

/** "Winston-Salem" → "winston-salem" */
export function citySlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** "winston-salem" → "Winston Salem" (title-cased, for display + API queries). */
export function cityFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
