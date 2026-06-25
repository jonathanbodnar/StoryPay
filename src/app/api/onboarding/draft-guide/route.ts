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
import { cleanCopy } from '@/lib/guide-copy';
import { loadEditedFields, markGuideFieldsEdited } from '@/lib/pricing-guide-edits';

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
  space_description: string;
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

function cleanDraft(d: DraftedGuide): DraftedGuide {
  return {
    congratulatory_message: cleanCopy(d.congratulatory_message),
    about_venue: cleanCopy(d.about_venue),
    pricing_intro: cleanCopy(d.pricing_intro),
    availability_text: cleanCopy(d.availability_text),
    cta_headline: cleanCopy(d.cta_headline),
    cta_body: cleanCopy(d.cta_body),
    cta_button_label: d.cta_button_label,
    package_name: d.package_name,
    package_description: cleanCopy(d.package_description),
    space_description: cleanCopy(d.space_description),
    capacity_label: d.capacity_label,
  };
}

function templateDraft(venueName: string, a: Answers): DraftedGuide {
  const incl =
    a.inclusivity === 'all_inclusive'
      ? 'an all-inclusive experience with everything handled under one roof'
      : 'a beautiful venue-only space you can make your own';
  return {
    congratulatory_message: `Congratulations on your engagement, and welcome to ${venueName}. We would be honored to host your wedding here. From your first tour to your last dance, our team is here to make planning feel calm, clear, and exciting. This guide walks you through everything you need to picture your day with us.`,
    about_venue: `${venueName} offers ${incl}. ${a.differentiators ? a.differentiators + '. ' : ''}Couples choose us because the setting, the spaces, and the flow all work together for a real wedding day, from quiet getting-ready moments to a full celebration with family and friends. Our team knows this place inside and out and loves helping you imagine exactly how your day will unfold here. Come see it in person, and we will help you picture the rest.`.trim(),
    pricing_intro: `Here is a clear look at our pricing and the venue features included so you can plan with confidence. We keep things transparent, with no hidden fees, and we are happy to tailor the details to fit your day.`,
    availability_text: a.seasonality
      ? `Availability: ${a.seasonality}`
      : `Dates book quickly, so reach out to check availability for your season.`,
    cta_headline: 'Ready to see it in person?',
    cta_body: `Schedule a tour of ${venueName} and let's start planning your perfect day.`,
    cta_button_label: 'Schedule a tour',
    package_name: 'Starting Package',
    package_description: a.inclusivity === 'all_inclusive'
      ? 'Our all-inclusive package covering your core wedding-day needs.'
      : 'Exclusive use of the venue for your wedding day.',
    space_description: a.inclusivity === 'all_inclusive'
      ? `${venueName} offers an all-inclusive space for your ceremony and reception, all in one place. Our team handles setup, service, and the details so you can stay present with your guests. The room flexes easily from a seated ceremony to a full reception, with plenty of space for dinner, a generous dance floor, and the little touches that make the day yours. Whether you are planning an intimate gathering or a lively party, we will help you arrange every detail so the day runs smoothly from the first toast to the last song.`
      : `${venueName} is a versatile space for your ceremony, dinner, and dancing, all under one roof. The room flexes easily from a seated ceremony to a full reception, with plenty of room for your guests, a generous dance floor, and the details that make the day feel like yours. Natural light and flexible layouts mean you can shape the space around your vision rather than the other way around. Whether you are planning an intimate dinner or a big celebration, our team will help you arrange every detail so the day flows beautifully.`,
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
    const prompt = `You are writing a warm, concise wedding-venue "Pricing & Availability Guide" for brides. Write in second person to the bride, friendly and confident, never generic or salesy. Output ONLY valid JSON.

STYLE RULES (follow strictly):
- NEVER use these banned words or any variant of them: "nestled", "timeless", "magical", "serene", "dream day", "backdrop". They are overused clichés.
- NEVER use salesy filler phrases like "Let's get started", "Let's get planning", or any call-to-action sign-off. Keep the welcome warm and congratulatory and let the bride simply move on.
- NEVER use em dashes or en dashes (— or –). Use a period or a comma instead.
- Write short, declarative, outcome-first sentences. No filler.

Venue: ${venueName}${loc ? ` (${loc})` : ''}
Existing description: ${description || '(none)'}
Max capacity: ${a.max_capacity || '(unknown)'}
Starting price: ${a.starting_price || '(unknown)'}
Inclusivity: ${a.inclusivity || '(unknown)'}
Seasonality / availability: ${a.seasonality || '(unknown)'}
Top differentiators: ${a.differentiators || '(unknown)'}

Write generously so each page of the printed guide feels full and warm. Do NOT write thin, one-line copy.

Return JSON with EXACTLY these string keys:
{
  "congratulatory_message": "3-4 warm sentences congratulating the bride, welcoming her, and previewing what this guide covers (about 350-450 characters)",
  "about_venue": "4-5 vivid sentences describing the venue, weaving in the differentiators and why couples love getting married here (about 450-650 characters, and NEVER exceed 680 characters)",
  "pricing_intro": "2-3 reassuring sentences introducing the pricing section, transparent and confident (about 250-350 characters)",
  "availability_text": "1-2 sentences about availability/seasonality and gentle urgency to book",
  "cta_headline": "short punchy headline inviting a tour",
  "cta_body": "1 sentence encouraging them to book a tour",
  "cta_button_label": "2-4 word button text",
  "package_name": "name for their starting package",
  "package_description": "1 sentence describing what the starting package includes",
  "space_description": "4-5 sentences describing the main event space: capacity, ceremony vs reception flow, layout flexibility, and what the space handles (about 500-650 characters)"
}`;

    const res = await client.chat.completions.create({
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1100,
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
      space_description: parsed.space_description || fallback.space_description,
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

  // Photos uploaded in the modal (manual / no-Google path). They're already in
  // the media library; here we seed the venue cover/gallery + guide gallery from
  // them (fill-empties only) so the listing and guide have images.
  const uploadedPhotos = Array.isArray(body.photos)
    ? (body.photos as unknown[]).filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 20)
    : [];

  const VENUE_TYPES = ['barn', 'ballroom', 'garden', 'winery', 'beach', 'estate', 'rustic', 'modern', 'historic', 'other'];
  const INDOOR_OUTDOOR = ['indoor', 'outdoor', 'both'];
  const venueType = typeof body.venue_type === 'string' && VENUE_TYPES.includes(body.venue_type) ? body.venue_type : null;
  const indoorOutdoor = typeof body.indoor_outdoor === 'string' && INDOOR_OUTDOOR.includes(body.indoor_outdoor) ? body.indoor_outdoor : null;

  // Sanitize social links: keep only known keys with non-empty string values.
  const SOCIAL_KEYS = ['facebook', 'instagram', 'tiktok', 'pinterest', 'website'];
  let socialLinks: Record<string, string> | null = null;
  if (body.social_links && typeof body.social_links === 'object' && !Array.isArray(body.social_links)) {
    const raw = body.social_links as Record<string, unknown>;
    const cleaned: Record<string, string> = {};
    for (const k of SOCIAL_KEYS) {
      const val = raw[k];
      if (typeof val === 'string' && val.trim()) cleaned[k] = val.trim().slice(0, 500);
    }
    socialLinks = cleaned;
  }

  // Capacity & price range → venue columns (single source of truth shared with
  // the listing's "Capacity & pricing" section). Parse to non-negative ints.
  const toInt = (v: unknown): number | null => {
    const n = Math.round(parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const capacityMin = toInt(body.capacity_min);
  const capacityMax = toInt(body.capacity_max);
  const priceMin = toInt(body.price_min);
  const priceMax = toInt(body.price_max);

  // Persist listing fields entered in the wizard onto the venue (single source
  // of truth — the public listing reads these).
  const venueFields: Record<string, unknown> = {};
  if (features) venueFields.features = features;
  if (venueType) venueFields.venue_type = venueType;
  if (indoorOutdoor) venueFields.indoor_outdoor = indoorOutdoor;
  if (socialLinks) venueFields.social_links = socialLinks;
  if (capacityMin != null) venueFields.capacity_min = capacityMin;
  if (capacityMax != null) venueFields.capacity_max = capacityMax;
  if (priceMin != null) venueFields.price_min = priceMin;
  if (priceMax != null) venueFields.price_max = priceMax;
  if (Object.keys(venueFields).length > 0) {
    await supabaseAdmin
      .from('venues')
      .update(venueFields)
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
  const draft = cleanDraft(
    (await aiDraft(
      venueName,
      (venue?.location_city as string) || '',
      (venue?.location_state as string) || '',
      (venue?.description as string) || '',
      aForAi,
    )) ?? templateDraft(venueName, a),
  );

  // ── Persist parent guide fields (guide-primary) ──────────────────────────────
  const guideId = await getOrCreatePricingGuideId(venueId);

  // Seed cover/gallery from photos uploaded in the modal (manual path). Mirrors
  // the Google import: fill-empties only so we never clobber existing imagery.
  if (uploadedPhotos.length > 0) {
    const { data: vRow } = await supabaseAdmin
      .from('venues')
      .select('cover_image_url, gallery_images')
      .eq('id', venueId)
      .maybeSingle();
    const vUpd: Record<string, unknown> = {};
    if (!((vRow?.cover_image_url as string | null) ?? '').trim()) vUpd.cover_image_url = uploadedPhotos[0];
    const existingVGallery = Array.isArray(vRow?.gallery_images) ? (vRow!.gallery_images as unknown[]) : [];
    if (existingVGallery.length === 0) vUpd.gallery_images = uploadedPhotos;
    if (Object.keys(vUpd).length > 0) {
      await supabaseAdmin.from('venues').update(vUpd).eq('id', venueId).then(undefined, () => {});
    }

    const { data: gRow } = await supabaseAdmin
      .from('venue_pricing_guides')
      .select('gallery, cover_image_url')
      .eq('id', guideId)
      .maybeSingle();
    const gUpd: Record<string, unknown> = {};
    const gExistingGallery = Array.isArray(gRow?.gallery) ? (gRow!.gallery as unknown[]) : [];
    if (gExistingGallery.length === 0) gUpd.gallery = uploadedPhotos.map((url) => ({ url }));
    if (!((gRow?.cover_image_url as string | null) ?? '').trim()) gUpd.cover_image_url = uploadedPhotos[0];
    if (Object.keys(gUpd).length > 0) {
      gUpd.updated_at = new Date().toISOString();
      await supabaseAdmin.from('venue_pricing_guides').update(gUpd).eq('id', guideId).then(undefined, () => {});
    }
  }

  // Manual content always wins: only (re)populate fields the owner has not
  // manually edited. Auto-filled fields (never user-edited) may be refreshed.
  const edited = await loadEditedFields(venueId);
  const { data: existingGuide } = await supabaseAdmin
    .from('venue_pricing_guides')
    .select('gallery, about_photos, availability_image_url')
    .eq('id', guideId)
    .maybeSingle();

  const guideUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const setIfAllowed = (field: string, value: unknown) => {
    if (!edited[field]) guideUpdate[field] = value;
  };
  setIfAllowed('congratulatory_message', draft.congratulatory_message);
  setIfAllowed('about_venue', draft.about_venue);
  setIfAllowed('pricing_intro', draft.pricing_intro);
  setIfAllowed('availability_text', draft.availability_text);
  setIfAllowed('cta_headline', draft.cta_headline);
  setIfAllowed('cta_body', draft.cta_body);
  // cta_button_label has no manual-override flag; always keep it current.
  guideUpdate.cta_button_label = draft.cta_button_label;

  // Image source-of-truth: seed the About 2x2 grid from the gallery (which the
  // Google import already populated + registered in the media library) so the
  // editor and the PDF read the same photos. Fill-empty + respect manual edits.
  const gallery = Array.isArray(existingGuide?.gallery) ? (existingGuide!.gallery as { url?: string }[]) : [];
  const aboutPhotos = Array.isArray(existingGuide?.about_photos) ? (existingGuide!.about_photos as unknown[]) : [];
  const galleryUrls = gallery.map((g) => g?.url).filter((u): u is string => !!u);
  if (!edited['about_photos'] && aboutPhotos.length === 0 && galleryUrls.length > 0) {
    guideUpdate.about_photos = galleryUrls.slice(0, 4).map((url) => ({ url }));
  }

  // Seed the Save the Date image so the section is populated after onboarding
  // (the editor + PDF both read guide.availability_image_url). Pick a photo
  // distinct from the cover/space hero (gallery[0]) when possible.
  const existingStdImage = (existingGuide as { availability_image_url?: string | null } | null)?.availability_image_url;
  if (!edited['availability_image_url'] && !existingStdImage && galleryUrls.length > 0) {
    guideUpdate.availability_image_url =
      galleryUrls[galleryUrls.length - 1] !== galleryUrls[0]
        ? galleryUrls[galleryUrls.length - 1]
        : galleryUrls[0];
  }

  const { error: guideErr } = await supabaseAdmin
    .from('venue_pricing_guides')
    .update(guideUpdate)
    .eq('id', guideId);
  if (guideErr) console.warn('[draft-guide] guide update', guideErr.message);

  // About text shares a single source of truth with the public listing
  // (venues.description). Seed it with the fuller AI copy unless the owner has
  // manually edited the About field (tracked via the about_venue edit flag).
  if (!edited['about_venue'] && draft.about_venue?.trim()) {
    await supabaseAdmin
      .from('venues')
      .update({ description: draft.about_venue })
      .eq('id', venueId)
      .then(undefined, () => { /* non-fatal */ });
  }

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
      // The package's "what's included" is a separate, package-specific concept
      // from the venue amenity chips (venues.features). Start it empty so the
      // owner fills in what this package actually includes.
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
      // Persist a real, editable description so the editor and PDF match
      // (no render-time-only evergreen text the owner cannot see or change).
      description: draft.space_description,
      capacity: draft.capacity_label,
      // Seed the space photo with the hero/building shot (gallery[0], the same
      // image used for the cover) so the main event space always shows the
      // actual building. The owner can swap it in the editor.
      image_url: galleryUrls[0] ?? null,
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
    if (typeof body[k] === 'string') guideUpdate[k] = cleanCopy(body[k] as string);
  }

  // About text is shared with the public listing (venues.description). When the
  // review step confirms/edits it, write the canonical column too so the guide,
  // the listing, and the PDF all read the same copy.
  if (typeof body.about_venue === 'string') {
    await supabaseAdmin
      .from('venues')
      .update({ description: cleanCopy(body.about_venue as string) })
      .eq('id', venueId)
      .then(undefined, () => { /* non-fatal */ });
  }
  if (Object.keys(guideUpdate).length > 1) {
    const { error } = await supabaseAdmin
      .from('venue_pricing_guides')
      .update(guideUpdate)
      .eq('id', guideId);
    if (error) console.warn('[draft-guide PATCH] guide update', error.message);
    // The review step is a deliberate confirm/override — flag these as edited
    // so a later modal re-run never overwrites them.
    void markGuideFieldsEdited(
      venueId,
      Object.keys(guideUpdate).filter((k) => k !== 'updated_at'),
    ).catch(() => { /* non-fatal */ });
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
