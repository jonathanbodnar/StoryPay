import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizeGa4MeasurementId, normalizeGa4PropertyId } from '@/lib/ga4';
import { isGa4DataApiConfigured } from '@/lib/ga4-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/**
 * GET /api/listing/analytics — GA4 measurement id for the current venue listing.
 */
export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('ga4_measurement_id, ga4_property_id, slug, name')
    .eq('id', venueId)
    .maybeSingle();

  if (error) {
    console.error('[GET /api/listing/analytics]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  const row = data as {
    ga4_measurement_id: string | null;
    ga4_property_id: string | null;
    slug: string | null;
    name: string | null;
  };
  return NextResponse.json({
    ga4_measurement_id: row.ga4_measurement_id,
    ga4_property_id: row.ga4_property_id,
    listing_slug: row.slug,
    venue_name: row.name,
    ga4_reports_available: isGa4DataApiConfigured(),
  });
}

/**
 * PATCH /api/listing/analytics
 * body: { ga4_measurement_id?: string | null, ga4_property_id?: string | null } — empty string clears; invalid format returns 400.
 */
export async function PATCH(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { ga4_measurement_id?: string | null; ga4_property_id?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!('ga4_measurement_id' in body) && !('ga4_property_id' in body)) {
    return NextResponse.json(
      { error: 'Provide ga4_measurement_id and/or ga4_property_id' },
      { status: 400 },
    );
  }

  const updates: { ga4_measurement_id?: string | null; ga4_property_id?: string | null } = {};

  if ('ga4_measurement_id' in body) {
    const raw = body.ga4_measurement_id;
    let next: string | null;
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
      next = null;
    } else if (typeof raw !== 'string') {
      return NextResponse.json({ error: 'ga4_measurement_id must be a string or null' }, { status: 400 });
    } else {
      const n = normalizeGa4MeasurementId(raw);
      if (n === null) {
        return NextResponse.json(
          {
            error:
              'Invalid GA4 Measurement ID. Use the format from Google Analytics: G- followed by letters and numbers (e.g. G-ABC123XY).',
          },
          { status: 400 },
        );
      }
      next = n;
    }
    updates.ga4_measurement_id = next;
  }

  if ('ga4_property_id' in body) {
    const raw = body.ga4_property_id;
    let next: string | null;
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
      next = null;
    } else if (typeof raw !== 'string') {
      return NextResponse.json({ error: 'ga4_property_id must be a string or null' }, { status: 400 });
    } else {
      const n = normalizeGa4PropertyId(raw);
      if (n === null) {
        return NextResponse.json(
          {
            error:
              'Invalid GA4 Property ID. Use only digits from Admin → Property settings (e.g. 123456789).',
          },
          { status: 400 },
        );
      }
      next = n;
    }
    updates.ga4_property_id = next;
  }

  const { data, error } = await supabaseAdmin
    .from('venues')
    .update(updates)
    .eq('id', venueId)
    .select('ga4_measurement_id, ga4_property_id, slug, name')
    .maybeSingle();

  if (error) {
    console.error('[PATCH /api/listing/analytics]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  const row = data as {
    ga4_measurement_id: string | null;
    ga4_property_id: string | null;
    slug: string | null;
    name: string | null;
  };
  return NextResponse.json({
    ga4_measurement_id: row.ga4_measurement_id,
    ga4_property_id: row.ga4_property_id,
    listing_slug: row.slug,
    venue_name: row.name,
    ga4_reports_available: isGa4DataApiConfigured(),
  });
}
