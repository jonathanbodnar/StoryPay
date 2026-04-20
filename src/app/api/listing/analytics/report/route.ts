import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchListingGa4Report, isGa4DataApiConfigured } from '@/lib/ga4-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/**
 * GET /api/listing/analytics/report?days=28 — GA4 Data API metrics for the venue’s saved property (listing-scoped when slug exists).
 */
export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const daysRaw = request.nextUrl.searchParams.get('days');
  const days = daysRaw ? parseInt(daysRaw, 10) : 28;

  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('ga4_property_id, slug')
    .eq('id', venueId)
    .maybeSingle();

  if (error) {
    console.error('[GET /api/listing/analytics/report]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  const row = data as { ga4_property_id: string | null; slug: string | null };

  if (!row.ga4_property_id?.trim()) {
    return NextResponse.json({
      ok: false,
      code: 'missing_property_id',
      message: 'Add your GA4 Property ID below to see metrics here.',
    });
  }

  if (!isGa4DataApiConfigured()) {
    return NextResponse.json({
      ok: false,
      code: 'missing_credentials',
      message:
        'In-dashboard reports are not enabled on this deployment. Ask your administrator to set GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON.',
    });
  }

  const result = await fetchListingGa4Report({
    propertyId: row.ga4_property_id,
    listingSlug: row.slug,
    days: Number.isFinite(days) ? days : 28,
  });

  return NextResponse.json(result);
}
