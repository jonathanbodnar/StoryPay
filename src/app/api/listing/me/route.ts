import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { LISTING_WRITABLE_FIELDS, slugify, type ListingWritableField } from '@/lib/directory';

export const dynamic = 'force-dynamic';

/**
 * The directory-facing projection of a `venues` row. Kept intentionally narrow
 * so internal StoryPay columns (brand_*, lunarpay_*, onboarding_status, …)
 * never leak to the dashboard client.
 */
const SELECT_COLUMNS = `
  id, slug, name, description, venue_type,
  location_full, location_city, location_state, lat, lng,
  capacity_min, capacity_max, price_min, price_max,
  indoor_outdoor, features, cover_image_url, gallery_images,
  availability_notes, is_published, onboarding_completed,
  notification_email, email_notifications,
  created_at, updated_at
`;

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sql = getDb();
  const rows = await sql.unsafe(
    `SELECT ${SELECT_COLUMNS} FROM public.venues WHERE id = $1 LIMIT 1`,
    [venueId],
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  return NextResponse.json({ listing: rows[0] });
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

  // Normalise slug: run through slugify; empty string clears it.
  if (typeof updates.slug === 'string') {
    updates.slug = updates.slug.length > 0 ? slugify(updates.slug) : null;
  }

  // postgres.js accepts JS arrays for jsonb, but be explicit for clarity.
  if (Array.isArray(updates.features)) {
    updates.features = JSON.stringify(updates.features);
  }
  if (Array.isArray(updates.gallery_images)) {
    updates.gallery_images = JSON.stringify(updates.gallery_images);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const sql = getDb();

  // If the caller is publishing but no slug is set, derive one from the name
  // (preferring the incoming update, falling back to the stored name).
  if (updates.is_published === true && (updates.slug == null || updates.slug === '')) {
    const venueRow = await sql`SELECT name, slug FROM public.venues WHERE id = ${venueId} LIMIT 1`;
    const existingSlug = venueRow[0]?.slug as string | null | undefined;
    if (!existingSlug) {
      const base =
        (typeof updates.name === 'string' && updates.name) ||
        (venueRow[0]?.name as string | undefined) ||
        'venue';
      let slug = slugify(base) || 'venue';
      const taken = await sql`SELECT 1 FROM public.venues WHERE slug = ${slug} AND id <> ${venueId} LIMIT 1`;
      if (taken.length > 0) slug = `${slug}-${venueId.slice(0, 8)}`;
      updates.slug = slug;
    }
  }

  try {
    const updated = await sql`
      UPDATE public.venues
      SET ${sql(updates as Record<string, unknown>)}
      WHERE id = ${venueId}
      RETURNING ${sql.unsafe(SELECT_COLUMNS)}
    `;

    if (updated.length === 0) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    return NextResponse.json({ listing: updated[0] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Unique violation on slug — surface a friendly error.
    if (/venues_slug_key|slug/.test(msg) && /duplicate|unique/i.test(msg)) {
      return NextResponse.json(
        { error: 'That slug is already taken. Please choose another.' },
        { status: 409 },
      );
    }
    console.error('[PATCH /api/listing/me] failed:', msg);
    return NextResponse.json({ error: 'Failed to update listing' }, { status: 500 });
  }
}
