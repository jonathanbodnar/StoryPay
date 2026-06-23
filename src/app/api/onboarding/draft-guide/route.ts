/**
 * POST /api/onboarding/draft-guide
 *
 * Step 2 of the onboarding wizard. Takes the 5 things Google can't tell us and
 * AI-drafts the full pricing & availability guide from the imported profile +
 * those answers. Persists the draft to the guide (guide-primary source) so the
 * preview step reads back a single source. Falls back to a template draft if
 * DeepSeek is unavailable so the flow never blocks.
 *
 * Body: {
 *   max_capacity?: number | string,
 *   starting_price?: number | string,   // low-friction single number for now
 *   inclusivity?: 'venue_only' | 'all_inclusive' | string,
 *   seasonality?: string,
 *   differentiators?: string,            // free text, top 2-3
 * }
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getOrCreatePricingGuideId } from '@/lib/pricing-guide';
import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/ai-client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

type Answers = {
  max_capacity: string;
  starting_price: string;
  inclusivity: string;
  seasonality: string;
  differentiators: string;
};

type DraftedGuide = {
  congratulatory_message: string;
  about_venue: string;
  pricing_intro: string;
  availability_text: string;
  cta_headline: string;
  cta_body: string;
  cta_button_label: string;
  package_name: string;
  package_description: string;
  capacity_label: string;
};

function priceLabel(starting: string): string {
  const digits = String(starting).replace(/[^0-9.]/g, '');
  if (!digits) return 'Contact for pricing';
  const n = Math.round(parseFloat(digits));
  if (Number.isNaN(n) || n <= 0) return 'Contact for pricing';
  return `Starting at $${n.toLocaleString('en-US')}`;
}

function capacityLabel(cap: string): string {
  const digits = String(cap).replace(/[^0-9]/g, '');
  if (!digits) return cap || 'Ask us about capacity';
  return `Up to ${parseInt(digits, 10).toLocaleString('en-US')} guests`;
}

function templateDraft(venueName: string, a: Answers): DraftedGuide {
  const incl =
    a.inclusivity === 'all_inclusive'
      ? 'an all-inclusive experience with everything handled under one roof'
      : 'a beautiful venue-only space you can make your own';
  return {
    congratulatory_message: `Congratulations on your engagement! We'd be honored to host your wedding at ${venueName}.`,
    about_venue: `${venueName} offers ${incl}. ${a.differentiators ? a.differentiators : ''}`.trim(),
    pricing_intro: `Here's a look at our pricing and what's included so you can plan with confidence.`,
    availability_text: a.seasonality
      ? `Availability: ${a.seasonality}`
      : `Dates book quickly — reach out to check availability for your season.`,
    cta_headline: 'Ready to see it in person?',
    cta_body: `Schedule a tour of ${venueName} and let's start planning your perfect day.`,
    cta_button_label: 'Schedule a tour',
    package_name: 'Starting Package',
    package_description: a.inclusivity === 'all_inclusive'
      ? 'Our all-inclusive package covering your core wedding-day needs.'
      : 'Exclusive use of the venue for your wedding day.',
    capacity_label: capacityLabel(a.max_capacity),
  };
}

async function aiDraft(
  venueName: string,
  city: string,
  state: string,
  description: string,
  a: Answers,
): Promise<DraftedGuide | null> {
  if (!process.env.DEEPSEEK_API_KEY) return null;
  try {
    const client = getDeepSeekClient();
    const loc = [city, state].filter(Boolean).join(', ');
    const prompt = `You are writing a warm, concise wedding-venue "Pricing & Availability Guide" for brides. Write in second person to the bride, friendly and confident, never generic or salesy. Avoid clichés like "dream day". Output ONLY valid JSON.

Venue: ${venueName}${loc ? ` (${loc})` : ''}
Existing description: ${description || '(none)'}
Max capacity: ${a.max_capacity || '(unknown)'}
Starting price: ${a.starting_price || '(unknown)'}
Inclusivity: ${a.inclusivity || '(unknown)'}
Seasonality / availability: ${a.seasonality || '(unknown)'}
Top differentiators: ${a.differentiators || '(unknown)'}

Return JSON with EXACTLY these string keys:
{
  "congratulatory_message": "1-2 sentences congratulating the bride and welcoming her",
  "about_venue": "2-3 sentence vivid description of the venue weaving in the differentiators",
  "pricing_intro": "1-2 sentences introducing the pricing section, transparent and reassuring",
  "availability_text": "1-2 sentences about availability/seasonality and urgency to book",
  "cta_headline": "short punchy headline inviting a tour",
  "cta_body": "1 sentence encouraging them to book a tour",
  "cta_button_label": "2-4 word button text",
  "package_name": "name for their starting package",
  "package_description": "1 sentence describing what the starting package includes"
}`;

    const res = await client.chat.completions.create({
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 700,
    });

    const raw = res.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as Partial<DraftedGuide>;
    const fallback = templateDraft(venueName, a);
    return {
      congratulatory_message: parsed.congratulatory_message || fallback.congratulatory_message,
      about_venue: parsed.about_venue || fallback.about_venue,
      pricing_intro: parsed.pricing_intro || fallback.pricing_intro,
      availability_text: parsed.availability_text || fallback.availability_text,
      cta_headline: parsed.cta_headline || fallback.cta_headline,
      cta_body: parsed.cta_body || fallback.cta_body,
      cta_button_label: parsed.cta_button_label || fallback.cta_button_label,
      package_name: parsed.package_name || fallback.package_name,
      package_description: parsed.package_description || fallback.package_description,
      capacity_label: capacityLabel(a.max_capacity),
    };
  } catch (e) {
    console.warn('[draft-guide] AI draft failed, using template', e);
    return null;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const a: Answers = {
    max_capacity: String(body.max_capacity ?? '').trim(),
    starting_price: String(body.starting_price ?? '').trim(),
    inclusivity: String(body.inclusivity ?? '').trim(),
    seasonality: String(body.seasonality ?? '').trim(),
    differentiators: String(body.differentiators ?? '').trim(),
  };

  const features = Array.isArray(body.features)
    ? (body.features as unknown[]).filter((f): f is string => typeof f === 'string').slice(0, 30)
    : null;

  // Persist selected listing features onto the venue (the listing reads these).
  if (features) {
    await supabaseAdmin
      .from('venues')
      .update({ features })
      .eq('id', venueId)
      .then(undefined, () => { /* non-fatal */ });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, location_city, location_state, description')
    .eq('id', venueId)
    .maybeSingle();

  const venueName = (venue?.name as string) || 'our venue';
  // Weave selected amenities into the differentiators we hand the AI.
  const aForAi: Answers = {
    ...a,
    differentiators: [a.differentiators, features?.length ? `Amenities: ${features.join(', ')}` : '']
      .filter(Boolean)
      .join('. '),
  };
  const draft =
    (await aiDraft(
      venueName,
      (venue?.location_city as string) || '',
      (venue?.location_state as string) || '',
      (venue?.description as string) || '',
      aForAi,
    )) ?? templateDraft(venueName, a);

  // ── Persist parent guide fields (guide-primary) ──────────────────────────────
  const guideId = await getOrCreatePricingGuideId(venueId);

  const { error: guideErr } = await supabaseAdmin
    .from('venue_pricing_guides')
    .update({
      congratulatory_message: draft.congratulatory_message,
      about_venue: draft.about_venue,
      pricing_intro: draft.pricing_intro,
      availability_text: draft.availability_text,
      cta_headline: draft.cta_headline,
      cta_body: draft.cta_body,
      cta_button_label: draft.cta_button_label,
      updated_at: new Date().toISOString(),
    })
    .eq('id', guideId);
  if (guideErr) console.warn('[draft-guide] guide update', guideErr.message);

  // ── Starting-price package (create one if none exist) ────────────────────────
  const label = priceLabel(a.starting_price);
  const { data: existingPkgs } = await supabaseAdmin
    .from('venue_pricing_guide_packages')
    .select('id')
    .eq('pricing_guide_id', guideId)
    .limit(1);

  if (!existingPkgs || existingPkgs.length === 0) {
    await supabaseAdmin.from('venue_pricing_guide_packages').insert({
      pricing_guide_id: guideId,
      name: draft.package_name,
      price_label: label,
      description: draft.package_description,
      included_items: [],
      position: 0,
    });
  }

  // ── Capacity space (create one if none exist) ────────────────────────────────
  const { data: existingSpaces } = await supabaseAdmin
    .from('venue_pricing_guide_spaces')
    .select('id')
    .eq('pricing_guide_id', guideId)
    .limit(1);

  if (!existingSpaces || existingSpaces.length === 0) {
    await supabaseAdmin.from('venue_pricing_guide_spaces').insert({
      pricing_guide_id: guideId,
      name: 'Main Event Space',
      description: a.inclusivity === 'all_inclusive' ? 'All-inclusive event space' : null,
      capacity: draft.capacity_label,
      position: 0,
    });
  }

  // ── Advance onboarding step (resume-email signal) ────────────────────────────
  await supabaseAdmin
    .from('venues')
    .update({ onboarding_last_step: 2 })
    .eq('id', venueId)
    .then(undefined, () => { /* non-fatal */ });

  return NextResponse.json({
    draft: {
      ...draft,
      price_label: label,
    },
  });
}

/**
 * PATCH /api/onboarding/draft-guide
 * Saves the venue's reviewed edits from the preview step. Pricing is the field
 * they must verify, so a raw price_label is accepted and written to the first
 * package. Other free-text fields update the guide parent.
 *
 * Body: { about_venue?, pricing_intro?, congratulatory_message?, price_label?, price? }
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const guideId = await getOrCreatePricingGuideId(venueId);

  const guideUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ['about_venue', 'pricing_intro', 'congratulatory_message', 'availability_text'] as const) {
    if (typeof body[k] === 'string') guideUpdate[k] = body[k];
  }
  if (Object.keys(guideUpdate).length > 1) {
    const { error } = await supabaseAdmin
      .from('venue_pricing_guides')
      .update(guideUpdate)
      .eq('id', guideId);
    if (error) console.warn('[draft-guide PATCH] guide update', error.message);
  }

  // Pricing — accept either a finished label or a raw number.
  let label: string | null = null;
  if (typeof body.price_label === 'string' && body.price_label.trim()) {
    label = body.price_label.trim();
  } else if (body.price !== undefined && body.price !== null && String(body.price).trim()) {
    label = priceLabel(String(body.price));
  }

  if (label) {
    const { data: firstPkg } = await supabaseAdmin
      .from('venue_pricing_guide_packages')
      .select('id')
      .eq('pricing_guide_id', guideId)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (firstPkg?.id) {
      await supabaseAdmin
        .from('venue_pricing_guide_packages')
        .update({ price_label: label })
        .eq('id', firstPkg.id);
    } else {
      await supabaseAdmin.from('venue_pricing_guide_packages').insert({
        pricing_guide_id: guideId,
        name: 'Starting Package',
        price_label: label,
        included_items: [],
        position: 0,
      });
    }
  }

  return NextResponse.json({ ok: true, price_label: label });
}
