/**
 * GET /api/public/venue/[venueId]/pricing-guide
 *
 * Returns the venue's pricing guide as a downloadable PDF.
 * No authentication required — this is the link included in the booking
 * system guide email/SMS.  The PDF is generated on every request so it
 * always reflects the latest version the venue owner saved.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  generatePricingGuidePdfServer,
  type GuideData,
  type VenueInfo,
} from '@/lib/pricing-guide-pdf-server';

export const dynamic = 'force-dynamic';

// Sane upper-bound so this doesn't time out on Railway (max function timeout is
// typically 30 s; fetching many images can take a few seconds).
export const maxDuration = 25;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  // ?dl=1  → force download (Content-Disposition: attachment)
  // default → inline (browser opens its native PDF viewer / preview)
  const forceDownload = req.nextUrl.searchParams.get('dl') === '1';
  const { venueId } = await params;

  if (!venueId) {
    return NextResponse.json({ error: 'Missing venueId' }, { status: 400 });
  }

  // ── Load venue info ────────────────────────────────────────────────────
  // The branding page saves the uploaded logo to `brand_logo_url`, with
  // `logo_url` kept as a legacy fallback. We grab both and the assembler
  // below picks whichever is populated.
  const { data: venue, error: venueErr } = await supabaseAdmin
    .from('venues')
    .select('name, location_city, location_state, logo_url, brand_logo_url')
    .eq('id', venueId)
    .maybeSingle();

  if (venueErr || !venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  // ── Load pricing guide ────────────────────────────────────────────────
  const { data: guide, error: guideErr } = await supabaseAdmin
    .from('venue_pricing_guides')
    .select('*')
    .eq('venue_id', venueId)
    .maybeSingle();

  if (guideErr && (guideErr as { code?: string }).code !== 'PGRST116') {
    console.error('[public pricing-guide PDF]', guideErr);
    return NextResponse.json({ error: 'Failed to load guide' }, { status: 500 });
  }

  // Load child rows (spaces + packages)
  const guideId = guide?.id ?? null;
  const [spacesRes, packagesRes] = await Promise.all([
    guideId
      ? supabaseAdmin
          .from('venue_pricing_guide_spaces')
          .select('*')
          .eq('pricing_guide_id', guideId)
          .order('position', { ascending: true })
      : Promise.resolve({ data: [] }),
    guideId
      ? supabaseAdmin
          .from('venue_pricing_guide_packages')
          .select('*')
          .eq('pricing_guide_id', guideId)
          .order('position', { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  // ── Assemble the data shapes ──────────────────────────────────────────
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
    spaces:  (spacesRes.data ?? []) as GuideData['spaces'],
    packages: (packagesRes.data ?? []) as GuideData['packages'],
  };

  const venueInfo: VenueInfo = {
    name:           venue.name           ?? null,
    location_city:  venue.location_city  ?? null,
    location_state: venue.location_state ?? null,
    // Prefer the dashboard-uploaded brand logo; fall back to the legacy column.
    logo_url:
      (venue as { brand_logo_url?: string | null }).brand_logo_url ??
      venue.logo_url ??
      null,
  };

  // ── Generate PDF ───────────────────────────────────────────────────────
  try {
    const pdfBuffer = await generatePricingGuidePdfServer(guideData, venueInfo);

    const safeName = (venue.name ?? 'venue').replace(/[^a-zA-Z0-9]/g, '_');
    const disposition = forceDownload
      ? `attachment; filename="${safeName}_Pricing_Guide.pdf"`
      : `inline; filename="${safeName}_Pricing_Guide.pdf"`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': disposition,
        // No caching — always freshly generated
        'Cache-Control':       'no-store',
      },
    });
  } catch (err) {
    console.error('[public pricing-guide PDF] generation error', err);
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
  }
}
