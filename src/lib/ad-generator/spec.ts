/**
 * Meta (Facebook/Instagram) ad generator — shared spec, types and prompts.
 *
 * The generator composites a venue's real photos, logo and name into three
 * 1080x1350 portrait ad templates and writes matching Meta ad copy (primary
 * text + headline) that can be pasted straight into Ads Manager.
 *
 * Creative + copy rules come directly from the operator's playbook:
 *  - Scroll-stopping, magazine-like, showcases the couple / venue.
 *  - Headline is a promise that moves an engaged bride to download the guide.
 *  - Position the venue as a "StoryVenue" a bride can see her story in.
 *  - 3–5 quick-read benefit bullets.
 *  - Primary text opens with an "engaged brides" hook + a line break.
 *  - Every benefit line in the copy gets a green checkmark.
 *  - CTA is always "Download the pricing and availability guide."
 *  - Minimal emojis (a simple "I do" / smiley is fine).
 */

export const AD_WIDTH = 1080;
export const AD_HEIGHT = 1350;

/** Canonical call to action used across every ad. */
export const AD_CTA = 'Download the pricing and availability guide.';
/** Shorter CTA used on the graphic itself. */
export const AD_CTA_SHORT = 'Download the free guide';

export type TemplateKey = 'editorial' | 'bold' | 'photo';
export const TEMPLATE_KEYS: TemplateKey[] = ['editorial', 'bold', 'photo'];

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  editorial: 'Editorial',
  bold: 'Bold headline',
  photo: 'Photo-forward',
};

/** Everything the generator needs about a venue to build ads. */
export interface VenueAdData {
  id: string;
  name: string;
  slug: string | null;
  city: string | null;
  state: string | null;
  brandColor: string;
  logoUrl: string | null;
  /** Ordered photo URLs, cover/hero first. */
  photos: string[];
  features: string[];
  capacityMin: number | null;
  capacityMax: number | null;
  venueType: string | null;
  indoorOutdoor: string | null;
  about: string | null;
  /** Human price like "$4,000" when we can find one. */
  priceFrom: string | null;
  tagline: string | null;
}

/** One generated ad concept: on-graphic creative copy + Meta paste-in copy. */
export interface AdCopyVariant {
  templateKey: TemplateKey;
  /** Promise headline rendered on the image. */
  imageHeadline: string;
  /** 3–5 short benefit phrases rendered on the image. */
  imageBullets: string[];
  /** Short CTA rendered on the image. */
  imageCta: string;
  /** Small kicker/eyebrow rendered above the headline (e.g. city). */
  kicker: string;
  /** Meta "Primary text" — pastes straight into Ads Manager. */
  primaryText: string;
  /** Meta "Headline" field (short). */
  metaHeadline: string;
  /** Meta "Description" field (optional, short). */
  description: string;
}

// ── Copy generation prompt ─────────────────────────────────────────────────

const COPY_SYSTEM_PROMPT = [
  'You are a senior direct-response Meta (Facebook/Instagram) ads copywriter for wedding venues.',
  'You write scroll-stopping ad copy that gets newly engaged brides to download a venue\'s free pricing & availability guide (a lead magnet).',
  '',
  'NON-NEGOTIABLE RULES:',
  '• Target audience is newly engaged brides. Primary text MUST open with a hook like "Hey engaged brides", "Calling all engaged brides", or the same with the city appended (e.g. "Calling all engaged brides in Pittsburgh").',
  '• The primary text MUST contain line breaks (blank lines) for skimmability. Never one dense paragraph.',
  '• Every benefit/feature line in the primary text MUST start with a green check emoji "✅".',
  '• The primary text MUST end with this exact call to action on its own line: "Download the pricing and availability guide."',
  '• Position the venue as a place a bride can picture her own story/wedding day — a "StoryVenue".',
  '• Confident, warm, specific. Use the real features/location provided. Never invent awards, prices, or facts not provided.',
  '• Minimal emojis. A single tasteful emoji in the hook is fine (👰 or a smiley). Do NOT sprinkle emojis except the ✅ on benefit lines.',
  '• American English, perfect grammar, no em dashes.',
  '',
  'You will produce EXACTLY 3 distinct concepts. Each targets a different graphic layout:',
  '  1. "editorial" — elegant, magazine feel. Headline is an emotional promise. 4 benefit bullets.',
  '  2. "bold" — punchy, high-contrast. Headline is a short bold promise (max ~6 words). 4 benefit bullets.',
  '  3. "photo" — photo-forward, minimal text. Headline very short (max ~5 words). Only 3 short benefit bullets.',
  '',
  'For each concept also write the on-graphic pieces:',
  '• imageHeadline — the promise headline shown ON the image (no period at end).',
  '• imageBullets — array of short benefit phrases (2–4 words each) shown on the image. editorial/bold: 4 items. photo: 3 items.',
  '• kicker — a tiny eyebrow line for the image (e.g. "{City} Weddings" or "Say I Do Here").',
  '',
  'And the Meta fields:',
  '• primaryText — the full paste-in primary text following ALL rules above (hook + line breaks + ✅ benefit lines + final CTA line).',
  '• metaHeadline — the Meta Headline field, max ~40 characters, a strong promise or offer.',
  '• description — the Meta Description field, one short sentence (optional supporting line).',
  '',
  'OUTPUT: Return ONLY valid JSON of the shape:',
  '{ "variants": [ { "templateKey": "editorial", "imageHeadline": "...", "imageBullets": ["...","...","...","..."], "kicker": "...", "imageCta": "Download the free guide", "primaryText": "...", "metaHeadline": "...", "description": "..." }, { "templateKey": "bold", ... }, { "templateKey": "photo", ... } ] }',
].join('\n');

export function buildCopyMessages(data: VenueAdData): { system: string; user: string } {
  const loc = [data.city, data.state].filter(Boolean).join(', ');
  const lines: string[] = ['VENUE CONTEXT:', `• Name: ${data.name}`];
  if (loc) lines.push(`• Location: ${loc}`);
  if (data.venueType) lines.push(`• Type: ${data.venueType}`);
  if (data.indoorOutdoor) lines.push(`• Setting: ${data.indoorOutdoor}`);
  if (data.capacityMin || data.capacityMax) {
    lines.push(`• Capacity: up to ${data.capacityMax ?? data.capacityMin} guests`);
  }
  if (data.priceFrom) lines.push(`• Packages starting at: ${data.priceFrom}`);
  if (data.features.length) lines.push(`• Features: ${data.features.slice(0, 14).join(', ')}`);
  if (data.about) lines.push(`• About: ${data.about.slice(0, 700)}`);

  const cityHook = data.city ? ` The city for the "engaged brides in {city}" hook is "${data.city}".` : '';

  const user = [
    lines.join('\n'),
    '',
    `Write the 3 ad concepts now for ${data.name}.${cityHook}`,
    'Use the real features and location above. Keep on-graphic bullets extremely short.',
  ].join('\n');

  return { system: COPY_SYSTEM_PROMPT, user };
}
