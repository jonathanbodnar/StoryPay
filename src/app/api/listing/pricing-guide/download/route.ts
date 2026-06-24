/**
 * GET /api/listing/pricing-guide/download
 *
 * Authenticated endpoint used by the dashboard "Preview guide" and
 * "Download PDF" buttons. Generates the PDF server-side using the exact
 * same renderer as the public link so owners always see what couples see.
 *
 * ?inline=1  → Content-Disposition: inline  (browser renders PDF)
 * default    → Content-Disposition: attachment (browser downloads)
 */
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  generatePricingGuidePdfServer,
  type GuideData,
  type VenueInfo,
} from '@/lib/pricing-guide-pdf-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 25;

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const inline = req.nextUrl.searchParams.get('inline') === '1';

  // ── Venue info ────────────────────────────────────────────────────────
  const { data: venue, error: venueErr } = await supabaseAdmin
    .from('venues')
    .select('name, location_city, location_state, location_full, lat, lng, brand_phone, brand_email, logo_url, brand_logo_url, social_links, features, owner_first_name, owner_last_name')
    .eq('id', venueId)
    .maybeSingle();

  if (venueErr || !venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  // ── Guide + child rows ────────────────────────────────────────────────
  const { data: guide, error: guideErr } = await supabaseAdmin
    .from('venue_pricing_guides')
    .select('*')
    .eq('venue_id', venueId)
    .maybeSingle();

  if (guideErr && (guideErr as { code?: string }).code !== 'PGRST116') {
    console.error('[dashboard pricing-guide download]', guideErr);
    return NextResponse.json({ error: 'Failed to load guide' }, { status: 500 });
  }

  const guideId = guide?.id ?? null;

  // If the venue uses a custom uploaded PDF, redirect directly to it
  if (guide?.use_custom_pricing_guide && guide?.custom_pricing_guide_url) {
    return NextResponse.redirect(guide.custom_pricing_guide_url);
  }

  const [spacesRes, packagesRes, accommodationsRes] = await Promise.all([
    guideId
      ? supabaseAdmin.from('venue_pricing_guide_spaces').select('*').eq('pricing_guide_id', guideId).order('position', { ascending: true })
      : Promise.resolve({ data: [] }),
    guideId
      ? supabaseAdmin.from('venue_pricing_guide_packages').select('*').eq('pricing_guide_id', guideId).order('position', { ascending: true })
      : Promise.resolve({ data: [] }),
    guideId
      ? supabaseAdmin.from('venue_pricing_guide_accommodations').select('*').eq('pricing_guide_id', guideId).order('position', { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  const guideData: GuideData = {
    cover_image_url:          guide?.cover_image_url          ?? null,
    cover_source_image_url:   guide?.cover_source_image_url   ?? null,
    congratulatory_message:   guide?.congratulatory_message   ?? null,
    gallery:                  (guide?.gallery as { url: string; caption?: string }[]) ?? [],
    about_photos:             (guide?.about_photos as { url: string; caption?: string }[]) ?? [],
    about_venue:              guide?.about_venue              ?? null,
    accommodations_text:      guide?.accommodations_text      ?? null,
    accommodations_photos:    (guide?.accommodations_photos as { url: string; caption?: string }[]) ?? [],
    accommodations_image_url: guide?.accommodations_image_url ?? null,
    pricing_intro:            guide?.pricing_intro            ?? null,
    reviews:                  (guide?.reviews as { author?: string; location?: string; body?: string; rating?: number }[]) ?? [],
    availability_text:        guide?.availability_text        ?? null,
    availability_image_url:   guide?.availability_image_url   ?? null,
    cta_headline:             guide?.cta_headline             ?? null,
    cta_body:                 guide?.cta_body                 ?? null,
    cta_button_label:         (guide?.cta_button_label as string) ?? 'Schedule a tour',
    spaces:         (spacesRes.data        ?? []) as GuideData['spaces'],
    packages:       (packagesRes.data      ?? []) as GuideData['packages'],
    accommodations: (accommodationsRes.data ?? []) as GuideData['accommodations'],
  };

  const venueInfo: VenueInfo = {
    name:           venue.name           ?? null,
    location_city:  venue.location_city  ?? null,
    location_state: venue.location_state ?? null,
    phone:          venue.brand_phone    ?? null,
    email:          venue.brand_email    ?? null,
    address_full:   venue.location_full  ?? null,
    lat:            (venue.lat as number) ?? null,
    lng:            (venue.lng as number) ?? null,
    logo_url:
      (venue as { brand_logo_url?: string | null }).brand_logo_url ??
      venue.logo_url ?? null,
    website:
      ((venue as { social_links?: { website?: string | null } }).social_links?.website) ?? null,
    features: Array.isArray((venue as { features?: unknown }).features)
      ? ((venue as { features: unknown[] }).features.filter(
          (f): f is string => typeof f === 'string',
        ))
      : [],
    owner_name: [
      (venue as { owner_first_name?: string | null }).owner_first_name,
      (venue as { owner_last_name?: string | null }).owner_last_name,
    ].filter(Boolean).join(' ').trim() || null,
  };

  // ── Generate PDF ──────────────────────────────────────────────────────
  try {
    const pdfBuffer = await generatePricingGuidePdfServer(guideData, venueInfo);
    const fileName = `${(venue.name ?? 'pricing-guide').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-guide.pdf`;

    return new NextResponse(pdfBuffer.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': inline
          ? `inline; filename="${fileName}"`
          : `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[dashboard pricing-guide download] PDF generation failed:', err);
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
  }
}
