import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

/**
 * GET /api/listing/pricing-guide/seed
 *
 * Returns a suggested fill-in for the pricing guide based on what the venue
 * has already filled out on their public listing. The dashboard page uses this
 * to one-click pre-populate the guide so owners don't start from a blank
 * canvas.
 *
 * The shape mirrors the guide payload returned by `/api/listing/pricing-guide`
 * but only includes fields where we found something useful — never returns
 * placeholder strings for empty source data.
 */
export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Pull the listing row + spaces + reviews in parallel ──────────────────
  const [venueRes, spacesRes, reviewsRes] = await Promise.all([
    supabaseAdmin
      .from('venues')
      .select(
        'id, name, description, venue_type, location_city, location_state, capacity_min, capacity_max, indoor_outdoor, features, cover_image_url, gallery_images, availability_notes',
      )
      .eq('id', venueId)
      .maybeSingle(),
    supabaseAdmin
      .from('venue_spaces')
      .select('id, name, description, capacity')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('listing_reviews')
      .select('rating, body, reviewer_name, wedding_date, status')
      .eq('venue_id', venueId)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(6),
  ]);

  const venue = (venueRes.data ?? null) as null | {
    id: string;
    name: string | null;
    description: string | null;
    venue_type: string | null;
    location_city: string | null;
    location_state: string | null;
    capacity_min: number | null;
    capacity_max: number | null;
    indoor_outdoor: string | null;
    features: string[] | null;
    cover_image_url: string | null;
    gallery_images: string[] | null;
    availability_notes: string | null;
  };

  if (!venue) {
    return NextResponse.json({ seed: {}, hasListing: false });
  }

  const seed: Record<string, unknown> = {};

  // ── About the venue: lifted directly from the listing description ───────
  if (venue.description?.trim()) {
    seed.about_venue = venue.description.trim();
  }

  // ── Cover source: the listing cover, fallback to first gallery image ────
  const coverSeed =
    venue.cover_image_url?.trim() ||
    (Array.isArray(venue.gallery_images) ? venue.gallery_images[0] : null);
  if (coverSeed) {
    seed.cover_source_image_url = coverSeed;
  }

  // ── Photo gallery: every gallery image, deduped, with the cover first ───
  const galleryUrls = Array.from(
    new Set(
      [
        venue.cover_image_url,
        ...(Array.isArray(venue.gallery_images) ? venue.gallery_images : []),
      ].filter((u): u is string => typeof u === 'string' && u.trim() !== ''),
    ),
  );
  if (galleryUrls.length > 0) {
    seed.gallery = galleryUrls.map((url) => ({ url }));
  }

  // ── Availability: lifted from listing's availability_notes ──────────────
  if (venue.availability_notes?.trim()) {
    seed.availability_text = venue.availability_notes.trim();
  }

  // ── Spaces: convert venue_spaces rows to guide-space shape ──────────────
  const spaces = (spacesRes.data ?? []) as Array<{
    id: string;
    name: string | null;
    description: string | null;
    capacity: number | string | null;
  }>;
  if (spaces.length > 0) {
    seed.spaces = spaces.map((s) => ({
      name: s.name,
      description: s.description,
      capacity:
        typeof s.capacity === 'number'
          ? `Up to ${s.capacity} guests`
          : (s.capacity ?? null),
    }));
  }

  // ── Reviews: pull approved listing reviews into guide-review shape ──────
  const reviews = (reviewsRes.data ?? []) as Array<{
    rating: number | null;
    body: string | null;
    reviewer_name: string | null;
    wedding_date: string | null;
  }>;
  if (reviews.length > 0) {
    seed.reviews = reviews.map((r) => ({
      author: r.reviewer_name ?? '',
      location: r.wedding_date ? `Married ${new Date(r.wedding_date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}` : '',
      body: r.body ?? '',
      rating: r.rating ?? 5,
    }));
  }

  // ── Soft, AI-improvable starter copy ────────────────────────────────────
  // We seed the user with high-converting placeholder language they can then
  // hit the "Improve with AI" button against. Better than asking them to write
  // from a blank box.
  if (!seed.congratulatory_message && venue.name) {
    seed.congratulatory_message =
      `Congratulations on your engagement. Thank you for considering ${venue.name} for your wedding day. ` +
      `We've put together this guide so you can picture exactly what your celebration could look like with us, ` +
      `compare packages with confidence, and reach out the moment you're ready to lock in your date.`;
  }

  if (!seed.cta_headline) {
    seed.cta_headline = 'Ready to walk the property?';
  }
  if (!seed.cta_body && venue.name) {
    seed.cta_body =
      `Pick a time that works for you and we'll roll out the red carpet. Tours are private, no-pressure, ` +
      `and the best way to feel whether ${venue.name} is the right home for your wedding day.`;
  }

  return NextResponse.json({
    seed,
    hasListing: true,
    venue: {
      name: venue.name,
      venue_type: venue.venue_type,
      location_city: venue.location_city,
      location_state: venue.location_state,
      capacity_min: venue.capacity_min,
      capacity_max: venue.capacity_max,
      indoor_outdoor: venue.indoor_outdoor,
      features: venue.features ?? [],
    },
  });
}
