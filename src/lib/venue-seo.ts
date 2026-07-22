/**
 * Automatic listing SEO — invisible to venue owners.
 *
 * generateVenueSeo(venueId) loads the venue's listing content, asks the LLM
 * for an optimized meta title / meta description / keyword set, and stores
 * them on the venue row (seo_title, seo_description, seo_keywords,
 * seo_generated_at). Falls back to solid templated values when the LLM is
 * unavailable, so a listing is never left without metadata.
 *
 * Triggers:
 *   - listing goes live (onboarding test-inquiry step)
 *   - owner edits listing content (name, description, location, type, FAQ…)
 *   - admin backfill route for already-live listings
 */

import { supabaseAdmin } from '@/lib/supabase';
import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/ai-client';
import { pingVenueUrl } from '@/lib/indexnow';

interface VenueSeoSource {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  location_city: string | null;
  location_state: string | null;
  venue_type: string | null;
  capacity_max: number | null;
  price_min: number | null;
  indoor_outdoor: string | null;
  features: string[] | null;
  is_published: boolean | null;
}

export interface VenueSeoResult {
  ok: boolean;
  seo_title?: string;
  seo_description?: string;
  seo_keywords?: string[];
  error?: string;
}

// ── Templated fallback (never leaves a listing without metadata) ─────────────

function templatedSeo(v: VenueSeoSource): { title: string; description: string; keywords: string[] } {
  const loc = [v.location_city, v.location_state].filter(Boolean).join(', ');
  const type = (v.venue_type || 'Wedding Venue').replace(/\s*&\s*/g, ' & ');

  const title = loc
    ? `${v.name} | Wedding Venue in ${loc}`.slice(0, 65)
    : `${v.name} | Wedding Venue`.slice(0, 65);

  const capacityBit = v.capacity_max ? ` Hosts up to ${v.capacity_max} guests.` : '';
  const description = (loc
    ? `${v.name} is a ${type.toLowerCase()} in ${loc}. View photos, pricing, availability and verified reviews.${capacityBit} Check your date today.`
    : `${v.name} wedding venue. View photos, pricing, availability and verified reviews.${capacityBit} Check your date today.`
  ).slice(0, 160);

  const keywords: string[] = [
    `${v.name}`,
    ...(v.location_city ? [`wedding venue ${v.location_city}`, `${v.location_city} wedding venues`] : []),
    ...(loc ? [`wedding venues in ${loc}`] : []),
    ...(v.venue_type ? [`${v.venue_type.toLowerCase()} wedding venue`] : []),
    'wedding venue pricing',
    'book a wedding venue tour',
  ];

  return { title, description, keywords };
}

// ── AI generation ─────────────────────────────────────────────────────────────

async function aiSeo(v: VenueSeoSource): Promise<{ title: string; description: string; keywords: string[] } | null> {
  if (!process.env.DEEPSEEK_API_KEY) return null;
  try {
    const client = getDeepSeekClient();
    const loc = [v.location_city, v.location_state].filter(Boolean).join(', ');

    const prompt = `You are an SEO specialist for a wedding venue directory. Generate search-optimized metadata for this venue's public listing page. Output ONLY valid JSON.

Venue name: ${v.name}
Location: ${loc || '(unknown)'}
Venue type: ${v.venue_type || '(unknown)'}
Max capacity: ${v.capacity_max ?? '(unknown)'}
Starting price: ${v.price_min ? `$${v.price_min}` : '(unknown)'}
Setting: ${v.indoor_outdoor || '(unknown)'}
Features: ${(v.features ?? []).slice(0, 10).join(', ') || '(unknown)'}
Description: ${(v.description || '').slice(0, 800) || '(none)'}

RULES:
- meta_title: 50-62 characters. MUST include the venue name AND a local keyword pattern like "Wedding Venue in {City}, {ST}". Front-load the venue name.
- meta_description: 140-158 characters. Compelling search snippet written to earn the click: mention location, one differentiator, and a soft call to action like "view pricing" or "check your date". Complete sentences, never cut off.
- keywords: 6-10 target search phrases a bride would actually type, mixing venue-brand searches ("${v.name}") and local discovery searches ("wedding venues in ${v.location_city || 'the area'}", "${(v.venue_type || 'barn').toLowerCase()} wedding venue ${v.location_state || ''}"). Lowercase except proper nouns.
- NEVER use em dashes. NEVER use the words "nestled", "timeless", "magical", "dream", "backdrop".
- Do not stuff keywords. Natural, human language only.

Return JSON exactly:
{ "meta_title": "...", "meta_description": "...", "keywords": ["...", "..."] }`;

    const res = await client.chat.completions.create({
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 500,
    });

    const raw = res.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as {
      meta_title?: string;
      meta_description?: string;
      keywords?: string[];
    };

    const title = (parsed.meta_title || '').trim();
    const description = (parsed.meta_description || '').trim();
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 12)
      : [];

    if (!title || !description) return null;
    return {
      title: title.slice(0, 70),
      description: description.slice(0, 165),
      keywords,
    };
  } catch (err) {
    console.warn('[venue-seo] AI generation failed, using template:', err);
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate (or regenerate) SEO metadata for a venue and persist it.
 * Safe to call repeatedly; also pings IndexNow when the listing is published.
 */
export async function generateVenueSeo(venueId: string): Promise<VenueSeoResult> {
  const { data: venue, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, slug, description, location_city, location_state, venue_type, capacity_max, price_min, indoor_outdoor, features, is_published')
    .eq('id', venueId)
    .maybeSingle();

  if (error || !venue) {
    return { ok: false, error: error?.message ?? 'Venue not found' };
  }

  const v = venue as unknown as VenueSeoSource;
  if (!v.name?.trim()) return { ok: false, error: 'Venue has no name' };

  const generated = (await aiSeo(v)) ?? templatedSeo(v);

  const { error: updErr } = await supabaseAdmin
    .from('venues')
    .update({
      seo_title:        generated.title,
      seo_description:  generated.description,
      seo_keywords:     generated.keywords,
      seo_generated_at: new Date().toISOString(),
    })
    .eq('id', venueId);

  if (updErr) {
    // Pre-migration schema — non-fatal, columns simply don't exist yet.
    if (/column/i.test(updErr.message)) {
      console.warn('[venue-seo] seo columns missing (run migration 173):', updErr.message);
      return { ok: false, error: 'seo_columns_missing' };
    }
    return { ok: false, error: updErr.message };
  }

  // Tell Bing/IndexNow the page is fresh (Bing feeds ChatGPT search).
  if (v.is_published && v.slug) {
    void pingVenueUrl(v.slug);
  }

  return {
    ok: true,
    seo_title: generated.title,
    seo_description: generated.description,
    seo_keywords: generated.keywords,
  };
}

/** Listing content fields that should trigger an SEO regeneration when edited. */
export const SEO_TRIGGER_FIELDS = new Set([
  'name',
  'description',
  'location_city',
  'location_state',
  'location_full',
  'venue_type',
  'capacity_max',
  'price_min',
  'indoor_outdoor',
  'features',
  'faq',
]);

/**
 * Fire-and-forget regeneration after a listing edit. Only regenerates when a
 * content field changed; never blocks the request.
 */
export function maybeRegenerateVenueSeo(venueId: string, changedFields: string[]): void {
  const relevant = changedFields.some((f) => SEO_TRIGGER_FIELDS.has(f));
  if (!relevant) return;
  void generateVenueSeo(venueId).catch((err) =>
    console.warn('[venue-seo] background regeneration failed:', err),
  );
}
