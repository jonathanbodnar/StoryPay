/**
 * Meta (Facebook/Instagram) ad generator — shared spec, types and prompts.
 *
 * The generator composites a venue's real photos, logo and name into the
 * operator's APPROVED 1080x1350 portrait templates and writes matching Meta ad
 * copy (primary text + headline) that can be pasted straight into Ads Manager.
 *
 * Approved templates (do not add others without new references):
 *  A. "editorial"  — cream left panel with the venue NAME as a Playfair Display
 *     headline, short bullet features, a charcoal down-arrow CTA, and a 3-photo
 *     vertical stack on the right. (Magnolia / Coto Valley references.)
 *  B. "pricing"    — full-bleed photo behind a light panel: short promise
 *     headline, short bullet features, a "Starting at $X" band, a rounded pill
 *     CTA, and 3 rounded photos down the right. (Gracefully Adorned reference.)
 *  C. "showcase"   — the editorial layout again with different hero photos and
 *     a different set of feature bullets, so a batch of 3 stays varied.
 *
 * Type rules (locked): Playfair Display for headlines, Open Sans for all body,
 * bullets and buttons.
 */

export const AD_WIDTH = 1080;
export const AD_HEIGHT = 1350;

/** Canonical call to action used in the Meta copy. */
export const AD_CTA = 'Download the pricing and availability guide.';

export type TemplateKey = 'editorial' | 'pricing';
export const TEMPLATE_KEYS: TemplateKey[] = ['editorial', 'pricing'];

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  editorial: 'Editorial',
  pricing: 'All-inclusive',
};

/**
 * One generation ("version") produces this many creatives so the operator has
 * real options to choose from. We only ship the two approved designs, so a batch
 * alternates between them — each slot gets its own copy + different hero photos.
 */
export const BATCH_TEMPLATES: TemplateKey[] = [
  'editorial', 'pricing', 'editorial', 'pricing', 'editorial', 'pricing',
];
export const BATCH_SIZE = BATCH_TEMPLATES.length;

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
  /** Promise headline rendered on the image (used by the pricing template). */
  imageHeadline: string;
  /** Short feature phrases (3–5 words) rendered on the image. */
  imageBullets: string[];
  /** Short CTA rendered on the image. */
  imageCta: string;
  /** Small kicker/eyebrow (unused by the approved templates; kept for copy). */
  kicker: string;
  /** Meta "Primary text" — pastes straight into Ads Manager. */
  primaryText: string;
  /** Meta "Headline" field (short). */
  metaHeadline: string;
}

// ── Copy generation prompt ─────────────────────────────────────────────────

const COPY_SYSTEM_PROMPT = [
  'You are a senior direct-response Meta (Facebook/Instagram) ads copywriter for wedding venues.',
  'You write scroll-stopping ad copy that gets newly engaged brides to download a venue\'s free pricing & availability guide (a lead magnet).',
  '',
  'NON-NEGOTIABLE RULES:',
  '• Target audience is newly engaged brides. Primary text MUST open with a hook like "Hey engaged brides", "Calling all engaged brides", or the same with the city appended (e.g. "Calling all engaged brides in Pittsburgh").',
  '• The primary text MUST contain line breaks (blank lines) for skimmability. Never one dense paragraph.',
  '• Every benefit/feature line in the primary text MUST start with a green check emoji "✅" AND be SHORT: 4-5 words max, feature-focused (e.g. "✅ Up to 220 guests", "✅ Onsite bridal suite"). No full sentences on the checkmark lines.',
  '• The primary text MUST end with this exact call to action on its own line: "Download the pricing and availability guide."',
  '• Position the venue as a place a bride can picture her own story/wedding day — a "StoryVenue".',
  '',
  'HEADLINES (imageHeadline) — this is the on-graphic hero line for EVERY concept:',
  '• Write a high-converting PROMISE headline about the bride\'s dream wedding day, tailored to what makes THIS venue special (use its real setting, features, capacity, location).',
  '• Follow the timeless direct-response principles of the greatest copywriters (Ogilvy, Halbert, Schwartz, Hopkins, Caples): lead with ONE specific, emotional benefit or promise; be concrete and evocative, not generic; make her feel her wedding day there.',
  '• 3-7 words, Title Case, no ending period, no quotes. Examples of the vibe (do NOT copy): "Where Your Forever Begins", "Say I Do Under Open Skies", "Your Dream Day, All Inclusive".',
  '• The venue NAME is rendered separately as a small eyebrow, so NEVER make the headline just the venue name.',
  '• Confident, warm, specific. Use the real features/location provided. Never invent awards, prices, or facts not provided.',
  '• Minimal emojis. A single tasteful emoji in the hook is fine (👰 or a smiley). Do NOT sprinkle emojis except the ✅ on benefit lines.',
  '• American English, perfect grammar, no em dashes.',
  '',
  'ON-GRAPHIC FEATURE BULLETS (imageBullets):',
  '• These render on the image next to bullet points. They MUST be extremely short scannable feature phrases: 3-5 words each, no trailing punctuation.',
  '• Prefer concrete, quick-read specifics: capacity, spaces, location, inclusions (e.g. "Up to 220 guests", "Onsite bridal suite", "Tables & chairs included", "Just outside Pittsburgh", "Vendor friendly").',
  '',
  'You will produce a set of concepts in a specific template order given in the user message.',
  'Template rules:',
  '• "editorial" — imageHeadline is a high-converting PROMISE headline (see HEADLINES above), 3-7 words. Provide 5 short feature bullets.',
  '• "pricing" — imageHeadline is a high-converting PROMISE headline, max ~5 words, leaning into value/all-inclusive when relevant. Provide 6 short feature bullets that lean into value/inclusions.',
  'VARIETY IS THE WHOLE POINT: every concept must feel like a genuinely different option. Use a DIFFERENT headline, DIFFERENT bullet set and DIFFERENT primary text for each. Never repeat a headline or primaryText.',
  '',
  'Also write the Meta fields for each concept:',
  '• primaryText — full paste-in primary text following ALL rules (hook + line breaks + SHORT ✅ feature lines + final CTA line).',
  '• metaHeadline — the Meta Headline field, max ~40 characters, a strong promise or offer.',
  '',
  'OUTPUT: Return ONLY valid JSON of the shape:',
  '{ "variants": [ { "templateKey": "editorial", "imageHeadline": "...", "imageBullets": ["...","...","...","...","..."], "kicker": "", "imageCta": "Download the pricing guide", "primaryText": "...", "metaHeadline": "..." }, ... one per requested template, in order ... ] }',
].join('\n');

export function buildCopyMessages(
  data: VenueAdData,
  templates: TemplateKey[] = BATCH_TEMPLATES,
  angle?: string,
): { system: string; user: string } {
  const loc = [data.city, data.state].filter(Boolean).join(', ');
  const lines: string[] = ['VENUE CONTEXT:', `• Name: ${data.name}`];
  if (loc) lines.push(`• Location: ${loc}`);
  if (data.venueType) lines.push(`• Type: ${data.venueType}`);
  if (data.indoorOutdoor) lines.push(`• Setting: ${data.indoorOutdoor}`);
  if (data.capacityMin || data.capacityMax) {
    lines.push(`• Capacity: up to ${data.capacityMax ?? data.capacityMin} guests`);
  }
  if (data.priceFrom) lines.push(`• Packages starting at: ${data.priceFrom}`);
  if (data.features.length) lines.push(`• Features: ${data.features.slice(0, 16).join(', ')}`);
  if (data.about) lines.push(`• About: ${data.about.slice(0, 700)}`);

  const cityHook = data.city ? ` The city for the "engaged brides in {city}" hook is "${data.city}".` : '';
  const n = templates.length;
  const order = templates.map((t, i) => `${i + 1}. ${t}`).join(', ');

  const user = [
    lines.join('\n'),
    '',
    `Write ${n} ad concept${n === 1 ? '' : 's'} now for ${data.name}, one per template in THIS exact order: ${order}.${cityHook}`,
    ...(angle ? [`Creative angle for this set: ${angle} (still keep every concept distinct).`] : []),
    'Keep on-graphic bullets to 3-5 words each. Keep the ✅ lines in the primary text to 4-5 words each.',
    `Make all ${n} distinct — different headline, different bullets and different primary text for each.`,
  ].join('\n');

  return { system: COPY_SYSTEM_PROMPT, user };
}
