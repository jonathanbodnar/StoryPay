/**
 * A venue's local time zone, from its ZIP code.
 *
 * Anything we email a venue with a time on it (LeadFinder's inbox copy, for
 * one) should read in the venue's own local time — never the server's UTC.
 * The ZIP is the most reliable signal we have: every venue has an address, and
 * the saved `venues.timezone` is often unset or left at a default.
 *
 * US ZIPs map to time zones by their 3-digit prefix. Most states sit in one
 * zone; the states that straddle two (Florida's panhandle, East vs Middle
 * Tennessee, western Kentucky, Indiana's corners, the Dakotas and Nebraska
 * panhandle, El Paso, the Idaho panhandle, eastern Oregon) are split by
 * prefix. That is exact for all but a handful of border counties.
 *
 * Pure: no I/O. Deliberately separate from ./venue-timezone (a client-side
 * module the calendar and pickers share) so the ZIP table never ships to the
 * browser.
 */

const ET = 'America/New_York';
const CT = 'America/Chicago';
const MT = 'America/Denver';
const MT_ID = 'America/Boise';          // Mountain time, Idaho / eastern Oregon
const AZ = 'America/Phoenix';           // no daylight saving
const PT = 'America/Los_Angeles';
const AK = 'America/Anchorage';
const HI = 'Pacific/Honolulu';
const IN_ET = 'America/Indiana/Indianapolis';
const MI_ET = 'America/Detroit';

/** Prefixes whose zone differs from the rest of their state. Checked first. */
const PREFIX_OVERRIDES: Record<number, string> = {
  324: CT, 325: CT,                                   // FL panhandle (Panama City, Pensacola)
  373: ET, 374: ET, 376: ET, 377: ET, 378: ET, 379: ET, // East Tennessee
  420: CT, 421: CT, 422: CT, 423: CT, 424: CT,        // western Kentucky
  463: CT, 464: CT, 476: CT, 477: CT,                 // Indiana: Gary area, Evansville area
  577: MT,                                            // western South Dakota (Rapid City)
  586: MT,                                            // SW North Dakota (Dickinson)
  693: MT,                                            // Nebraska panhandle (Scottsbluff)
  798: MT, 799: MT, 885: MT,                          // El Paso, TX
  835: PT, 838: PT,                                   // Idaho panhandle (Lewiston, Coeur d'Alene)
  979: MT_ID,                                         // eastern Oregon (Ontario)
};

/** [first prefix, last prefix, zone] — USPS 3-digit ranges by state. */
const PREFIX_RANGES: Array<[number, number, string]> = [
  [5, 5, ET],                     // NY (Holtsville)
  [6, 7, 'America/Puerto_Rico'],
  [8, 8, 'America/St_Thomas'],   // US Virgin Islands
  [9, 9, 'America/Puerto_Rico'],
  [10, 89, ET],                   // New England, NJ
  [100, 149, ET],                 // NY
  [150, 199, ET],                 // PA, DE
  [200, 268, ET],                 // DC, MD, VA, WV
  [270, 299, ET],                 // NC, SC
  [300, 319, ET],                 // GA
  [320, 349, ET],                 // FL
  [350, 369, CT],                 // AL
  [370, 385, CT],                 // TN (Middle/West; East overridden above)
  [386, 397, CT],                 // MS
  [398, 399, ET],                 // GA
  [400, 427, ET],                 // KY (western part overridden above)
  [430, 459, ET],                 // OH
  [460, 479, IN_ET],              // IN
  [480, 499, MI_ET],              // MI
  [500, 528, CT],                 // IA
  [530, 549, CT],                 // WI
  [550, 567, CT],                 // MN
  [569, 569, ET],                 // DC
  [570, 577, CT],                 // SD
  [580, 588, CT],                 // ND
  [590, 599, MT],                 // MT
  [600, 629, CT],                 // IL
  [630, 658, CT],                 // MO
  [660, 679, CT],                 // KS
  [680, 693, CT],                 // NE
  [700, 714, CT],                 // LA
  [716, 729, CT],                 // AR
  [730, 749, CT],                 // OK (733: Austin TX, also Central)
  [750, 799, CT],                 // TX
  [800, 816, MT],                 // CO
  [820, 831, MT],                 // WY
  [832, 838, MT_ID],              // ID
  [840, 847, MT],                 // UT
  [850, 865, AZ],                 // AZ
  [870, 884, MT],                 // NM
  [889, 898, PT],                 // NV
  [900, 961, PT],                 // CA
  [967, 968, HI],                 // HI
  [969, 969, 'Pacific/Guam'],
  [970, 979, PT],                 // OR
  [980, 994, PT],                 // WA
  [995, 999, AK],                 // AK
];

/** The IANA time zone for a US ZIP code, or null when it is not one we know. */
export function timeZoneForUsZip(zip: string | null | undefined): string | null {
  const digits = (zip ?? '').trim().match(/^(\d{5})(?:[-\s]?\d{4})?$/)?.[1];
  if (!digits) return null;
  const prefix = Number(digits.slice(0, 3));
  if (PREFIX_OVERRIDES[prefix]) return PREFIX_OVERRIDES[prefix];
  for (const [lo, hi, zone] of PREFIX_RANGES) {
    if (prefix >= lo && prefix <= hi) return zone;
  }
  return null; // military (APO/FPO) or unassigned
}

/** Dominant zone per state — only a fallback for venues without a usable ZIP. */
const STATE_ZONES: Record<string, string> = {
  AL: CT, AK: AK, AZ: AZ, AR: CT, CA: PT, CO: MT, CT: ET, DE: ET, DC: ET, FL: ET,
  GA: ET, HI: HI, ID: MT_ID, IL: CT, IN: IN_ET, IA: CT, KS: CT, KY: ET, LA: CT, ME: ET,
  MD: ET, MA: ET, MI: MI_ET, MN: CT, MS: CT, MO: CT, MT: MT, NE: CT, NV: PT, NH: ET,
  NJ: ET, NM: MT, NY: ET, NC: ET, ND: CT, OH: ET, OK: CT, OR: PT, PA: ET, RI: ET,
  SC: ET, SD: CT, TN: CT, TX: CT, UT: MT, VT: ET, VA: ET, WA: PT, WV: ET, WI: CT,
  WY: MT, PR: 'America/Puerto_Rico',
};

const STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM',
  'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'puerto rico': 'PR',
};

export function timeZoneForUsState(state: string | null | undefined): string | null {
  const s = (state ?? '').trim();
  if (!s) return null;
  const code = s.length === 2 ? s.toUpperCase() : STATE_NAMES[s.toLowerCase()];
  return (code && STATE_ZONES[code]) || null;
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface VenueTimeZoneFields {
  zip?: string | null;
  brand_zip?: string | null;
  timezone?: string | null;
  state?: string | null;
  location_state?: string | null;
  brand_state?: string | null;
}

/**
 * The venue's time zone: its ZIP first (the address is the truth), then the
 * saved `timezone`, then its state. Null only when the venue has none of them.
 *
 * (Distinct from `resolveVenueTimezone` in ./venue-timezone, which normalises
 * the saved column for the calendar and pickers and never looks at the ZIP.)
 */
export function venueTimeZoneFromLocation(v: VenueTimeZoneFields | null | undefined): string | null {
  if (!v) return null;
  const fromZip = timeZoneForUsZip(v.zip) ?? timeZoneForUsZip(v.brand_zip);
  if (fromZip) return fromZip;
  const saved = (v.timezone ?? '').trim();
  if (saved && isValidTimeZone(saved)) return saved;
  return timeZoneForUsState(v.location_state) ?? timeZoneForUsState(v.state) ?? timeZoneForUsState(v.brand_state);
}
