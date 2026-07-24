/**
 * AI Concierge — venue knowledge base.
 *
 * generateVenueKnowledge(venueId) loads a venue's listing content + pricing-guide
 * TEXT (never price fields), runs a hard pricing sanitizer, and asks the LLM for
 * a compact, truthful, venue-specific knowledge summary plus a single best
 * `venue_detail_highlight` (one specific, texture-rich, verifiable amenity). The
 * result is cached on the venue row so the prompt builder can inject real
 * amenities into the `{{venue_knowledge}}` and `{{venue_detail_highlight}}`
 * tokens.
 *
 * HARD RULE: absolutely NO pricing may leak into the knowledge base. Every dollar
 * amount, price label, deposit, package price, and price-adjacent number is
 * stripped before it reaches the LLM — and the FINAL output is sanitized again
 * (defense in depth) so even an LLM slip can't emit a figure.
 *
 * Triggers (mirrors venue-seo.ts):
 *   - owner edits listing content (name, description, venue_type, features, …)
 *   - owner edits pricing-guide spaces / packages / accommodations / about text
 *   - admin backfill route for already-live venues
 */

import { supabaseAdmin } from '@/lib/supabase';
import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/ai-client';

// ── Source shapes ───────────────────────────────────────────────────────────

interface VenueKnowledgeSource {
  id:             string;
  name:           string | null;
  description:    string | null;
  venue_type:     string | null;
  capacity_max:   number | null;
  indoor_outdoor: string | null;
  features:       string[] | null;
  location_city:  string | null;
  location_state: string | null;
  faq:            Array<{ question?: string; answer?: string }> | null;
}

interface GuideText {
  about_venue:         string | null;
  accommodations_text: string | null;
  availability_text:   string | null;
}

interface GuideSpace {
  name:        string | null;
  description: string | null;
  capacity:    string | null;
}

interface GuideAccommodation {
  name:        string | null;
  description: string | null;
}

interface GuidePackage {
  name:           string | null;
  included_items: string[] | null;
}

export interface VenueKnowledgeResult {
  ok:                 boolean;
  knowledge_block?:   string;
  detail_highlight?:  string;
  error?:             string;
}

// ── Hard pricing sanitizer ──────────────────────────────────────────────────

/**
 * Sentence-level price signal — if a sentence trips this, we drop the WHOLE
 * sentence (a partial scrub could leave "packages start at" dangling). Broad on
 * purpose: over-stripping is acceptable, a leaked figure is not.
 */
const PRICE_SENTENCE = /(\$|\bdeposit|\bstarting at\b|\bstarts at\b|\bprice|\bpricing\b|\bpricy\b|\bcost|\bfee\b|\bfees\b|\brate\b|\brates\b|\bper\s+(?:person|guest|head|plate|night|hour|day)\b|\d+\s*(?:per|\/)\s*(?:person|guest|head|plate|night|hour|day)|\busd\b|\bdollars?\b|\beuros?\b|\bpounds?\b)/i;

/**
 * Strip every price-adjacent token from a block of free text.
 *
 * Two layers:
 *   1. Drop any whole sentence that contains a price signal.
 *   2. Token-level scrub of currency-looking numbers ($5,000 / 5,000 / 5000.00 /
 *      "150 per guest"), the "$" glyph itself, "starting at", and "deposit".
 *
 * Bare integers (e.g. capacities like "200") are intentionally KEPT — they're
 * valuable amenity facts and are not currency-looking on their own.
 */
export function stripPricing(input: string | null | undefined): string {
  if (!input) return '';
  const sentences = String(input).split(/(?<=[.!?\n])\s+/);
  let out = sentences.filter((s) => !PRICE_SENTENCE.test(s)).join(' ');

  out = out
    .replace(/\$\s*\d[\d,]*(?:\.\d+)?/g, ' ')                              // $5,000 / $ 5000.00
    .replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, ' ')                      // 5,000 grouped thousands
    .replace(/\b\d+\.\d{2}\b/g, ' ')                                        // 5000.00 decimal money
    .replace(/\b\d+\s*(?:per|\/)\s*(?:person|guest|head|plate|night|hour|day|event)\b/gi, ' ')
    .replace(/\bstarting at\b/gi, ' ')
    .replace(/\bstarts at\b/gi, ' ')
    .replace(/\bdeposit\w*/gi, ' ')
    .replace(/[$€£]/g, ' ');

  return out.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
}

/** Sanitize a single short line (space/package/accommodation names, features). */
function cleanLine(s: string | null | undefined): string {
  return stripPricing(s).replace(/\s+/g, ' ').trim();
}

// ── Loaders ─────────────────────────────────────────────────────────────────

async function loadVenueSource(venueId: string): Promise<VenueKnowledgeSource | null> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select('id, name, description, venue_type, capacity_max, indoor_outdoor, features, location_city, location_state, faq')
    .eq('id', venueId)
    .maybeSingle();
  return (data as unknown as VenueKnowledgeSource | null) ?? null;
}

/**
 * Read-only pricing-guide lookup (never creates a row — unlike
 * getOrCreatePricingGuideId — so a backfill over hundreds of venues doesn't
 * spawn empty guides). Returns the guide id + text fields, or null.
 * NOTE: pricing_intro is deliberately NEVER selected.
 */
async function loadGuide(
  venueId: string,
): Promise<{ id: string; text: GuideText } | null> {
  const { data } = await supabaseAdmin
    .from('venue_pricing_guides')
    .select('id, about_venue, accommodations_text, availability_text')
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as { id: string } & GuideText;
  return {
    id: row.id,
    text: {
      about_venue:         row.about_venue,
      accommodations_text: row.accommodations_text,
      availability_text:   row.availability_text,
    },
  };
}

async function loadGuideChildren(guideId: string): Promise<{
  spaces:         GuideSpace[];
  accommodations: GuideAccommodation[];
  packages:       GuidePackage[];
}> {
  const [spacesRes, accRes, pkgRes] = await Promise.all([
    supabaseAdmin
      .from('venue_pricing_guide_spaces')
      .select('name, description, capacity')
      .eq('pricing_guide_id', guideId)
      .order('position', { ascending: true }),
    supabaseAdmin
      .from('venue_pricing_guide_accommodations')
      .select('name, description')
      .eq('pricing_guide_id', guideId)
      .order('position', { ascending: true }),
    // NOTE: price_label / price columns are deliberately NEVER selected.
    supabaseAdmin
      .from('venue_pricing_guide_packages')
      .select('name, included_items')
      .eq('pricing_guide_id', guideId)
      .order('position', { ascending: true }),
  ]);
  return {
    spaces:         (spacesRes.data as GuideSpace[] | null) ?? [],
    accommodations: (accRes.data as GuideAccommodation[] | null) ?? [],
    packages:       (pkgRes.data as GuidePackage[] | null) ?? [],
  };
}

// ── Fact assembly ────────────────────────────────────────────────────────────

interface AssembledFacts {
  lines:  string[];
  spaces: GuideSpace[];
  features: string[];
}

function assembleFacts(
  v: VenueKnowledgeSource,
  guideText: GuideText | null,
  children: { spaces: GuideSpace[]; accommodations: GuideAccommodation[]; packages: GuidePackage[] } | null,
): AssembledFacts {
  const loc = [v.location_city, v.location_state].filter(Boolean).join(', ');
  const features = (v.features ?? []).map(cleanLine).filter(Boolean);
  const lines: string[] = [];

  if (v.venue_type)     lines.push(`Venue type: ${cleanLine(v.venue_type)}`);
  if (v.indoor_outdoor) lines.push(`Setting: ${cleanLine(v.indoor_outdoor)}`);
  if (v.capacity_max)   lines.push(`Accommodates up to ${v.capacity_max} guests`);
  if (loc)              lines.push(`Location: ${loc}`);
  if (features.length)  lines.push(`Features: ${features.join(', ')}`);

  const desc = cleanLine(v.description);
  if (desc)                     lines.push(`About: ${desc}`);
  if (guideText?.about_venue)         { const t = cleanLine(guideText.about_venue);         if (t) lines.push(`About (guide): ${t}`); }
  if (guideText?.accommodations_text) { const t = cleanLine(guideText.accommodations_text); if (t) lines.push(`Accommodations: ${t}`); }
  if (guideText?.availability_text)   { const t = cleanLine(guideText.availability_text);   if (t) lines.push(`Availability notes: ${t}`); }

  const spaces = children?.spaces ?? [];
  for (const s of spaces) {
    const name = cleanLine(s.name);
    if (!name) continue;
    const bits = [cleanLine(s.description), s.capacity ? `capacity ${cleanLine(s.capacity)}` : ''].filter(Boolean);
    lines.push(`Space — ${name}${bits.length ? `: ${bits.join('; ')}` : ''}`);
  }
  for (const a of children?.accommodations ?? []) {
    const name = cleanLine(a.name);
    if (!name) continue;
    const d = cleanLine(a.description);
    lines.push(`Accommodation — ${name}${d ? `: ${d}` : ''}`);
  }
  for (const p of children?.packages ?? []) {
    const name = cleanLine(p.name);
    if (!name) continue;
    const items = (p.included_items ?? []).map(cleanLine).filter(Boolean);
    lines.push(`Package — ${name}${items.length ? ` includes: ${items.join(', ')}` : ''}`);
  }
  for (const f of v.faq ?? []) {
    const q = cleanLine(f.question);
    const a = cleanLine(f.answer);
    if (q && a) lines.push(`FAQ — ${q} ${a}`);
  }

  return { lines: lines.filter(Boolean), spaces, features };
}

// ── Deterministic fallback (never leaves knowledge empty) ────────────────────

function deriveHighlight(facts: AssembledFacts, v: VenueKnowledgeSource): string {
  // Prefer a named space with a description (richest, most specific).
  const richSpace = facts.spaces.find((s) => cleanLine(s.name) && cleanLine(s.description));
  if (richSpace) {
    const d = cleanLine(richSpace.description);
    return `${cleanLine(richSpace.name)} — ${d.length > 120 ? `${d.slice(0, 117)}…` : d}`;
  }
  const firstSpace = facts.spaces.find((s) => cleanLine(s.name));
  if (firstSpace) return cleanLine(firstSpace.name);
  if (facts.features.length) return facts.features[0];
  if (v.indoor_outdoor) return `a ${cleanLine(v.indoor_outdoor)} setting`;
  if (v.venue_type)     return `a ${cleanLine(v.venue_type)} wedding venue`;
  return '';
}

function templateKnowledge(facts: AssembledFacts, v: VenueKnowledgeSource): { knowledge: string; highlight: string } {
  return {
    knowledge: facts.lines.slice(0, 25).map((l) => `- ${l}`).join('\n'),
    highlight: deriveHighlight(facts, v),
  };
}

// ── AI generation ────────────────────────────────────────────────────────────

async function aiKnowledge(
  facts: AssembledFacts,
  v: VenueKnowledgeSource,
): Promise<{ knowledge: string; highlight: string } | null> {
  if (!process.env.DEEPSEEK_API_KEY) return null;
  if (facts.lines.length === 0) return null;
  try {
    const client = getDeepSeekClient();
    const sourceFacts = facts.lines.slice(0, 40).join('\n');

    const prompt = `You are building a compact factual knowledge base about a specific wedding venue, to be used by an SMS assistant. Use ONLY the facts provided below — never invent amenities, never guess. Output ONLY valid JSON.

VENUE: ${v.name || '(unknown)'}
SOURCE FACTS (already pricing-scrubbed):
${sourceFacts}

Produce:
1. "knowledge": a tight bullet list (max 12 bullets, each one short line starting with "- ") of the most useful, concrete, verifiable amenities and characteristics a bride would care about (spaces, settings, capacity, notable features, accommodations, what packages include). Merge duplicates. Keep every fact grounded in the source above.
2. "detail_highlight": ONE single specific, texture-rich, verifiable feature worth spotlighting in a text message (e.g. "a covered stone pavilion that works rain or shine", "a 200-year-old restored barn with original beams"). Must be grounded in the source facts. One sentence, no more than 18 words.

ABSOLUTE RULES:
- NEVER mention pricing, prices, dollar amounts, deposits, fees, packages costs, or any money figure of any kind. This is critical.
- NEVER use em dashes as sentence punctuation. NEVER use "nestled", "timeless", "magical", "dream", "backdrop".
- Do not fabricate. If a fact is not in the source, do not state it.

Return JSON exactly:
{ "knowledge": "- ...\\n- ...", "detail_highlight": "..." }`;

    const res = await client.chat.completions.create({
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 700,
    });

    const raw = res.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as { knowledge?: string; detail_highlight?: string };
    const knowledge = (parsed.knowledge || '').trim();
    const highlight = (parsed.detail_highlight || '').trim();
    if (!knowledge) return null;
    return { knowledge, highlight };
  } catch (err) {
    console.warn('[venue-knowledge] AI generation failed, using template:', err);
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate (or regenerate) the venue knowledge base and persist it on the venue
 * row. Safe to call repeatedly. Never throws price data into the prompt: the
 * final output is sanitized one more time before it's stored.
 */
export async function generateVenueKnowledge(venueId: string): Promise<VenueKnowledgeResult> {
  const v = await loadVenueSource(venueId);
  if (!v) return { ok: false, error: 'Venue not found' };
  if (!v.name?.trim()) return { ok: false, error: 'Venue has no name' };

  const guide    = await loadGuide(venueId);
  const children = guide ? await loadGuideChildren(guide.id) : null;
  const facts    = assembleFacts(v, guide?.text ?? null, children);

  const generated = (await aiKnowledge(facts, v)) ?? templateKnowledge(facts, v);

  // Defense in depth: sanitize the FINAL output too, so even an LLM slip can't
  // emit a dollar figure.
  const knowledge_block  = stripPricing(generated.knowledge);
  const detail_highlight = stripPricing(generated.highlight);

  const { error: updErr } = await supabaseAdmin
    .from('venues')
    .update({
      ai_venue_knowledge:              knowledge_block,
      ai_venue_detail_highlight:       detail_highlight,
      ai_venue_knowledge_generated_at: new Date().toISOString(),
    })
    .eq('id', venueId);

  if (updErr) {
    if (/column/i.test(updErr.message)) {
      console.warn('[venue-knowledge] columns missing (run migration 182):', updErr.message);
      return { ok: false, error: 'knowledge_columns_missing' };
    }
    return { ok: false, error: updErr.message };
  }

  return { ok: true, knowledge_block, detail_highlight };
}

/**
 * Load the cached venue knowledge for the prompt builder. Falls back gracefully
 * to a deterministic block built from the venue's basics if generation hasn't
 * run yet (or the columns don't exist), so the prompt token is never empty.
 */
export async function loadVenueKnowledge(
  venueId: string,
): Promise<{ knowledge_block: string; detail_highlight: string }> {
  // Try the cached columns first.
  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('ai_venue_knowledge, ai_venue_detail_highlight')
    .eq('id', venueId)
    .maybeSingle();

  if (!error && data) {
    const row = data as unknown as { ai_venue_knowledge: string | null; ai_venue_detail_highlight: string | null };
    const knowledge_block  = stripPricing(row.ai_venue_knowledge);
    const detail_highlight = stripPricing(row.ai_venue_detail_highlight);
    if (knowledge_block) {
      return { knowledge_block, detail_highlight };
    }
  }

  // Not generated yet (or columns missing) — build a light deterministic block.
  const v = await loadVenueSource(venueId);
  if (!v) return { knowledge_block: '(no additional venue details on file)', detail_highlight: '' };
  const facts = assembleFacts(v, null, null);
  const fallback = templateKnowledge(facts, v);
  return {
    knowledge_block:  stripPricing(fallback.knowledge) || '(no additional venue details on file)',
    detail_highlight: stripPricing(fallback.highlight),
  };
}

/** Listing content fields that should trigger a knowledge regeneration when edited. */
export const KNOWLEDGE_TRIGGER_FIELDS = new Set([
  'name',
  'description',
  'venue_type',
  'capacity_max',
  'indoor_outdoor',
  'features',
  'faq',
  'location_city',
  'location_state',
]);

/**
 * Fire-and-forget regeneration after a listing edit. Only regenerates when a
 * relevant content field changed; never blocks the request. Mirrors
 * maybeRegenerateVenueSeo.
 */
export function maybeRegenerateVenueKnowledge(venueId: string, changedFields: string[]): void {
  const relevant = changedFields.some((f) => KNOWLEDGE_TRIGGER_FIELDS.has(f));
  if (!relevant) return;
  void generateVenueKnowledge(venueId).catch((err) =>
    console.warn('[venue-knowledge] background regeneration failed:', err),
  );
}

/**
 * Fire-and-forget regeneration after ANY pricing-guide content edit (spaces,
 * packages, accommodations, about/accommodations/availability text). Pricing
 * guide edits always change amenity-relevant text, so no field filter needed.
 */
export function triggerVenueKnowledgeRegen(venueId: string): void {
  void generateVenueKnowledge(venueId).catch((err) =>
    console.warn('[venue-knowledge] background regeneration failed:', err),
  );
}
