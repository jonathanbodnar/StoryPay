import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { LISTING_WRITABLE_FIELDS, slugify, type ListingWritableField } from '@/lib/directory';

export const dynamic = 'force-dynamic';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sql = getDb();
  const rows = await sql`
    SELECT *
    FROM public.venue_listings
    WHERE storypay_venue_id = ${venueId}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return NextResponse.json({ listing: null });
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

  if (typeof updates.slug === 'string' && updates.slug.length > 0) {
    updates.slug = slugify(updates.slug);
  } else if (updates.slug === '') {
    updates.slug = null;
  }

  if (Array.isArray(updates.features)) {
    updates.features = JSON.stringify(updates.features);
  }
  if (Array.isArray(updates.gallery_images)) {
    updates.gallery_images = JSON.stringify(updates.gallery_images);
  }

  const sql = getDb();

  const existing = await sql`
    SELECT id FROM public.venue_listings WHERE storypay_venue_id = ${venueId} LIMIT 1
  `;

  if (existing.length === 0) {
    const venueRow = await sql`
      SELECT name FROM public.venues WHERE id = ${venueId} LIMIT 1
    `;
    const defaultName = (venueRow[0]?.name as string | undefined) ?? 'Untitled Venue';
    const nameForSlug =
      (typeof updates.name === 'string' && updates.name) ? updates.name : defaultName;
    const baseSlug = slugify(nameForSlug);
    let slug = (typeof updates.slug === 'string' && updates.slug) || baseSlug || 'venue';
    const taken = await sql`SELECT 1 FROM public.venue_listings WHERE slug = ${slug} LIMIT 1`;
    if (taken.length > 0) {
      slug = `${slug}-${venueId.slice(0, 8)}`;
    }

    const insertObj: Record<string, unknown> = {
      storypay_venue_id: venueId,
      slug,
      name: (updates.name as string | undefined) ?? defaultName,
    };
    for (const field of LISTING_WRITABLE_FIELDS) {
      if (field === 'slug' || field === 'name') continue;
      if (field in updates) insertObj[field] = updates[field];
    }

    const inserted = await sql`
      INSERT INTO public.venue_listings ${sql(insertObj)}
      RETURNING *
    `;
    return NextResponse.json({ listing: inserted[0] });
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const updated = await sql`
    UPDATE public.venue_listings
    SET ${sql(updates as Record<string, unknown>)}
    WHERE storypay_venue_id = ${venueId}
    RETURNING *
  `;

  return NextResponse.json({ listing: updated[0] });
}
