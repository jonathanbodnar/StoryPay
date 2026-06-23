/**
 * POST /api/listing/google-reviews/import-profile
 *
 * Onboarding "magic moment" — given a resolved Google Place ID, pulls the full
 * Business Profile (name, address, hours, description, rating, type, top photos)
 * and reviews, re-hosts the top 5 photos into our own storage bucket, and
 * mirrors the data onto the venue + its pricing guide so the wizard can draft
 * from a single source.
 *
 * Body: { place_id: string }
 * Returns: { profile, photos: string[], imported: { ... } }
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isValidGooglePlaceId } from '@/lib/google-place-reviews';
import { refreshVenueGoogleReviews } from '@/lib/venue-google-reviews';
import {
  fetchGooglePlaceProfile,
  resolveGooglePhotoUri,
} from '@/lib/google-place-profile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'venue-images';
const MAX_PHOTOS = 8;

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/** Download a Google photo and re-host it in our public bucket. Returns the public URL or null. */
async function rehostPhoto(
  venueId: string,
  photoUri: string,
  index: number,
): Promise<string | null> {
  try {
    const res = await fetch(photoUri, { redirect: 'follow', next: { revalidate: 0 } });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > 10 * 1024 * 1024) return null;

    const ext = contentType.includes('png')
      ? 'png'
      : contentType.includes('webp')
        ? 'webp'
        : 'jpg';
    const objectKey = `${venueId}/google-import/${Date.now()}-${index}.${ext}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(objectKey, buffer, { contentType, upsert: true });
    if (upErr) {
      console.warn('[import-profile] upload failed', upErr.message);
      return null;
    }
    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(objectKey);
    return pub.publicUrl ?? null;
  } catch (e) {
    console.warn('[import-profile] rehostPhoto error', e);
    return null;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let placeId = '';
  try {
    const body = await req.json();
    placeId = typeof body?.place_id === 'string' ? body.place_id.trim() : '';
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isValidGooglePlaceId(placeId)) {
    return NextResponse.json({ error: 'A valid Google place_id is required.' }, { status: 400 });
  }

  const profile = await fetchGooglePlaceProfile(placeId);
  if (!profile) {
    return NextResponse.json(
      { error: "Couldn't import from Google. Check the listing and try again, or enter details manually." },
      { status: 502 },
    );
  }

  // Re-host the top N photos (sequential to stay polite to Google + storage).
  // Google doesn't tag photos as exterior/interior, but building/outside shots
  // are almost always landscape-oriented — so we prefer the first landscape
  // photo as the cover, falling back to Google's own ranking (photo[0]).
  const rehostedPairs: { url: string; landscape: boolean }[] = [];
  for (let i = 0; i < Math.min(profile.photos.length, MAX_PHOTOS); i++) {
    const uri = await resolveGooglePhotoUri(profile.photos[i].name);
    if (!uri) continue;
    const publicUrl = await rehostPhoto(venueId, uri, i);
    if (!publicUrl) continue;
    const p = profile.photos[i];
    rehostedPairs.push({ url: publicUrl, landscape: (p.widthPx ?? 0) > (p.heightPx ?? 0) });
  }

  const rehosted: string[] = rehostedPairs.map((r) => r.url);
  const coverIdx = rehostedPairs.findIndex((r) => r.landscape);
  if (coverIdx > 0) {
    const [cover] = rehosted.splice(coverIdx, 1);
    rehosted.unshift(cover);
  }

  // ── Mirror onto the venue (fill empties only — never clobber edits) ──────────
  const { data: venueRow } = await supabaseAdmin
    .from('venues')
    .select(
      'description, location_city, location_state, location_full, lat, lng, venue_type, cover_image_url, gallery_images',
    )
    .eq('id', venueId)
    .maybeSingle();

  const v = (venueRow ?? {}) as Record<string, unknown>;
  const venueUpdate: Record<string, unknown> = { google_place_id: placeId };
  const isEmpty = (x: unknown) =>
    x === null || x === undefined || (typeof x === 'string' && x.trim() === '');

  if (isEmpty(v.description) && profile.description) venueUpdate.description = profile.description;
  if (isEmpty(v.location_city) && profile.city) venueUpdate.location_city = profile.city;
  if (isEmpty(v.location_state) && profile.state) venueUpdate.location_state = profile.state;
  if (isEmpty(v.location_full) && profile.formatted_address)
    venueUpdate.location_full = profile.formatted_address;
  if (v.lat == null && profile.lat != null) venueUpdate.lat = profile.lat;
  if (v.lng == null && profile.lng != null) venueUpdate.lng = profile.lng;
  if (isEmpty(v.venue_type) && profile.venue_type) venueUpdate.venue_type = profile.venue_type;
  if (isEmpty(v.cover_image_url) && rehosted[0]) venueUpdate.cover_image_url = rehosted[0];

  const existingGallery = Array.isArray(v.gallery_images) ? (v.gallery_images as unknown[]) : [];
  if (existingGallery.length === 0 && rehosted.length > 0) {
    venueUpdate.gallery_images = rehosted;
  }

  const { error: venueErr } = await supabaseAdmin
    .from('venues')
    .update(venueUpdate)
    .eq('id', venueId);
  if (venueErr) console.warn('[import-profile] venue update', venueErr.message);

  // ── Refresh Google reviews cache (reuses existing helper) ────────────────────
  const reviewsCache = await refreshVenueGoogleReviews(venueId, placeId).catch(() => null);

  // ── Seed the pricing guide (guide-primary source of truth) ───────────────────
  // gallery → guide.gallery, description → about_venue, photos[0] → cover,
  // google reviews → guide.reviews. Fill empties only.
  const { data: guideRow } = await supabaseAdmin
    .from('venue_pricing_guides')
    .select('id, gallery, about_venue, cover_image_url, reviews')
    .eq('venue_id', venueId)
    .maybeSingle();

  const guideUpdate: Record<string, unknown> = { venue_id: venueId };
  const g = (guideRow ?? {}) as Record<string, unknown>;
  const gGallery = Array.isArray(g.gallery) ? (g.gallery as unknown[]) : [];
  if (gGallery.length === 0 && rehosted.length > 0) {
    guideUpdate.gallery = rehosted.map((url) => ({ url }));
  }
  if (isEmpty(g.about_venue) && profile.description) guideUpdate.about_venue = profile.description;
  if (isEmpty(g.cover_image_url) && rehosted[0]) guideUpdate.cover_image_url = rehosted[0];

  const gReviews = Array.isArray(g.reviews) ? (g.reviews as unknown[]) : [];
  if (gReviews.length === 0 && reviewsCache?.reviews?.length) {
    guideUpdate.reviews = reviewsCache.reviews.slice(0, 6).map((r) => ({
      author: r.author_name,
      location: profile.city && profile.state ? `${profile.city}, ${profile.state}` : '',
      body: r.text,
      rating: r.rating,
    }));
  }

  if (Object.keys(guideUpdate).length > 1) {
    guideUpdate.updated_at = new Date().toISOString();
    const { error: guideErr } = await supabaseAdmin
      .from('venue_pricing_guides')
      .upsert(guideUpdate, { onConflict: 'venue_id' });
    if (guideErr) console.warn('[import-profile] guide upsert', guideErr.message);
  }

  return NextResponse.json({
    profile: {
      place_id: profile.place_id,
      name: profile.name,
      formatted_address: profile.formatted_address,
      city: profile.city,
      state: profile.state,
      rating: profile.rating,
      user_ratings_total: profile.user_ratings_total,
      description: profile.description,
      hours: profile.hours,
      website: profile.website,
      phone: profile.phone,
      venue_type: profile.venue_type,
    },
    photos: rehosted,
    review_count: reviewsCache?.reviews?.length ?? 0,
  });
}
