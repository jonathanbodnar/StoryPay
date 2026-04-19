import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function corsHeaders() {
  const origin = process.env.PUBLIC_DIRECTORY_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

/**
 * Public directory payload: published venue profile + published listing reviews.
 * Consumed by storyvenue.com (or any origin allowed by PUBLIC_DIRECTORY_ORIGIN).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug || '').trim().toLowerCase();
  if (!slug || slug.length > 120) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400, headers: corsHeaders() });
  }

  const { data: venue, error: vErr } = await supabaseAdmin
    .from('venues')
    .select(
      [
        'id',
        'name',
        'slug',
        'description',
        'location_full',
        'location_city',
        'location_state',
        'venue_type',
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
      ].join(','),
    )
    .eq('slug', slug)
    .maybeSingle();

  if (vErr) {
    console.error('[public/venues GET]', vErr);
    return NextResponse.json({ error: 'Failed to load venue' }, { status: 500, headers: corsHeaders() });
  }
  const row = venue as Record<string, unknown> | null;
  if (!row || row.is_published !== true) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: corsHeaders() });
  }

  const venueId = String(row.id ?? '');
  if (!venueId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: corsHeaders() });
  }

  let average_rating: number | null = null;
  let review_count = 0;
  const items: Array<{
    id: string;
    rating: number;
    title: string | null;
    body: string;
    reviewer_name: string;
    wedding_date: string | null;
    created_at: string;
  }> = [];

  const { data: revs, error: rErr } = await supabaseAdmin
    .from('listing_reviews')
    .select('id, rating, title, body, reviewer_name, wedding_date, created_at')
    .eq('venue_id', venueId)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(80);

  if (rErr) {
    const msg = rErr.message?.toLowerCase() ?? '';
    if (!msg.includes('does not exist') && !msg.includes('42p01')) {
      console.warn('[public/venues GET] listing_reviews:', rErr.message);
    }
  } else if (revs?.length) {
    review_count = revs.length;
    const sum = revs.reduce((a, r) => a + Number((r as { rating: number }).rating), 0);
    average_rating = Math.round((sum / revs.length) * 10) / 10;
    for (const r of revs) {
      const row = r as {
        id: string;
        rating: number;
        title: string | null;
        body: string;
        reviewer_name: string;
        wedding_date: string | null;
        created_at: string;
      };
      items.push({
        id: row.id,
        rating: row.rating,
        title: row.title,
        body: row.body,
        reviewer_name: row.reviewer_name,
        wedding_date: row.wedding_date,
        created_at: row.created_at,
      });
    }
  }

  const v = row;

  const body = {
    venue: {
      name: String(v.name ?? ''),
      slug: String(v.slug ?? slug),
      description: v.description != null ? String(v.description) : null,
      location_full: v.location_full != null ? String(v.location_full) : null,
      location_city: v.location_city != null ? String(v.location_city) : null,
      location_state: v.location_state != null ? String(v.location_state) : null,
      venue_type: v.venue_type != null ? String(v.venue_type) : null,
      capacity_min: v.capacity_min != null ? Number(v.capacity_min) : null,
      capacity_max: v.capacity_max != null ? Number(v.capacity_max) : null,
      price_min: v.price_min != null ? Number(v.price_min) : null,
      price_max: v.price_max != null ? Number(v.price_max) : null,
      indoor_outdoor: v.indoor_outdoor != null ? String(v.indoor_outdoor) : null,
      features: Array.isArray(v.features) ? (v.features as string[]) : [],
      cover_image_url: v.cover_image_url != null ? String(v.cover_image_url) : null,
      gallery_images: Array.isArray(v.gallery_images) ? (v.gallery_images as string[]) : [],
      availability_notes: v.availability_notes != null ? String(v.availability_notes) : null,
    },
    reviews: {
      average_rating,
      count: review_count,
      items,
    },
  };

  return NextResponse.json(body, { headers: corsHeaders() });
}
