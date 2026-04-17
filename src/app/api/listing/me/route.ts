import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { LISTING_WRITABLE_FIELDS, slugify, type ListingWritableField } from '@/lib/directory';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SELECT_COLUMNS = [
  'id',
  'slug',
  'name',
  'description',
  'venue_type',
  'location_full',
  'location_city',
  'location_state',
  'lat',
  'lng',
  'capacity_min',
  'capacity_max',
  'price_min',
  'price_max',
  'indoor_outdoor',
  'features',
  'cover_image_url',
  'gallery_images',
  'availability_notes',
  'is_published',
  'onboarding_completed',
  'notification_email',
  'email_notifications',
  'created_at',
  'updated_at',
].join(',');

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('venues')
    .select(SELECT_COLUMNS)
    .eq('id', venueId)
    .maybeSingle();

  if (error) {
    console.error('[GET /api/listing/me] failed:', error);
    return NextResponse.json({ error: `Failed to load listing: ${error.message}` }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  return NextResponse.json({ listing: data });
}

export async function PATCH(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Partial<Record<ListingWritableField, unknown>> = {};
  for (const field of LISTING_WRITABLE_FIELDS) {
    if (field in body) {
      updates[field] = body[field] ?? null;
    }
  }

  if (typeof updates.slug === 'string') {
    const s = updates.slug.trim();
    updates.slug = s.length > 0 ? slugify(s) : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  // If publishing but no slug is set, derive one from the venue's name.
  if (updates.is_published === true && (updates.slug == null || updates.slug === '')) {
    const { data: existing } = await supabaseAdmin
      .from('venues')
      .select('name, slug')
      .eq('id', venueId)
      .maybeSingle();

    if (!existing?.slug) {
      const base =
        (typeof updates.name === 'string' && updates.name) ||
        existing?.name ||
        'venue';
      let candidate = slugify(base) || 'venue';
      const { data: clash } = await supabaseAdmin
        .from('venues')
        .select('id')
        .eq('slug', candidate)
        .neq('id', venueId)
        .limit(1);
      if (clash && clash.length > 0) {
        candidate = `${candidate}-${venueId.slice(0, 8)}`;
      }
      updates.slug = candidate;
    }
  }

  const { data: updated, error } = await supabaseAdmin
    .from('venues')
    .update(updates)
    .eq('id', venueId)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    const msg = error.message || 'Unknown error';
    if (/duplicate|unique/i.test(msg) && /slug/i.test(msg)) {
      return NextResponse.json(
        { error: 'That URL slug is already taken. Please choose another.' },
        { status: 409 },
      );
    }
    console.error('[PATCH /api/listing/me] failed:', error);
    return NextResponse.json({ error: `Failed to update listing: ${msg}` }, { status: 500 });
  }

  if (!updated) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  return NextResponse.json({ listing: updated });
}
