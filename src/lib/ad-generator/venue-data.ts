/**
 * Assemble the creative inputs (photos, brand, features, price) for a venue's
 * Meta ads from the venue row + its pricing guide.
 */

import { supabaseAdmin } from '@/lib/supabase';
import type { VenueAdData } from '@/lib/ad-generator/spec';

const DEFAULT_BRAND = '#293745';

function firstMoneyString(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    if (!t) continue;
    const m = t.match(/\$\s?\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\$\s?\d{3,}(?:\.\d{2})?/);
    if (m) return m[0].replace(/\s/g, '');
  }
  return null;
}

function cleanUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  const out: string[] = [];
  for (const u of urls) {
    const url = typeof u === 'string' ? u : (u && typeof u === 'object' && 'url' in u ? String((u as { url: unknown }).url) : '');
    if (url && /^https?:\/\//.test(url)) out.push(url);
  }
  return out;
}

interface VenueRow {
  id: string;
  name: string | null;
  slug: string | null;
  brand_color: string | null;
  logo_url: string | null;
  brand_logo_url: string | null;
  cover_image_url: string | null;
  gallery_images: unknown;
  city: string | null;
  state: string | null;
  location_city: string | null;
  location_state: string | null;
  brand_city: string | null;
  brand_state: string | null;
  venue_type: string | null;
  indoor_outdoor: string | null;
  features: unknown;
  capacity_min: number | null;
  capacity_max: number | null;
  brand_tagline: string | null;
}

export async function getVenueAdData(venueId: string): Promise<VenueAdData | null> {
  // The long concatenated select can't be type-inferred by supabase-js, so we
  // cast the row to an explicit shape below.
  const { data: vRaw } = await supabaseAdmin
    .from('venues')
    .select(
      'id, name, slug, brand_color, logo_url, brand_logo_url, cover_image_url, gallery_images, ' +
      'city, state, location_city, location_state, brand_city, brand_state, ' +
      'venue_type, indoor_outdoor, features, capacity_min, capacity_max, brand_tagline',
    )
    .eq('id', venueId)
    .maybeSingle();

  const v = vRaw as unknown as VenueRow | null;
  if (!v) return null;

  const { data: guide } = await supabaseAdmin
    .from('venue_pricing_guides')
    .select('id, gallery, about_venue, pricing_intro, cover_source_image_url')
    .eq('venue_id', venueId)
    .maybeSingle();

  let packagePrices: string | null = null;
  let spacePhotos: string[] = [];
  if (guide?.id) {
    const [{ data: pkgs }, { data: spaces }] = await Promise.all([
      supabaseAdmin
        .from('venue_pricing_guide_packages')
        .select('price_label')
        .eq('pricing_guide_id', guide.id),
      supabaseAdmin
        .from('venue_pricing_guide_spaces')
        .select('image_url, position')
        .eq('pricing_guide_id', guide.id)
        .order('position', { ascending: true }),
    ]);
    packagePrices = firstMoneyString(...(pkgs ?? []).map((p) => p.price_label as string));
    spacePhotos = cleanUrls((spaces ?? []).map((s) => s.image_url));
  }

  // Photos: cover first, then gallery, then guide gallery, then space photos. Dedupe.
  const photoSet = new Set<string>();
  const photos: string[] = [];
  const push = (u: string | null | undefined) => {
    if (u && /^https?:\/\//.test(u) && !photoSet.has(u)) {
      photoSet.add(u);
      photos.push(u);
    }
  };
  push(v.cover_image_url as string | null);
  for (const u of cleanUrls(v.gallery_images)) push(u);
  for (const u of cleanUrls(guide?.gallery)) push(u);
  for (const u of spacePhotos) push(u);

  return {
    id: v.id as string,
    name: (v.name as string) || 'Your Venue',
    slug: (v.slug as string | null) ?? null,
    city: (v.location_city as string | null) || (v.city as string | null) || (v.brand_city as string | null) || null,
    state: (v.location_state as string | null) || (v.state as string | null) || (v.brand_state as string | null) || null,
    brandColor: (v.brand_color as string) || DEFAULT_BRAND,
    logoUrl: (v.logo_url as string | null) || (v.brand_logo_url as string | null) || null,
    photos,
    features: Array.isArray(v.features) ? (v.features as unknown[]).map(String).filter(Boolean) : [],
    capacityMin: (v.capacity_min as number | null) ?? null,
    capacityMax: (v.capacity_max as number | null) ?? null,
    venueType: (v.venue_type as string | null) ?? null,
    indoorOutdoor: (v.indoor_outdoor as string | null) ?? null,
    about: (guide?.about_venue as string | null) ?? null,
    priceFrom: firstMoneyString(guide?.pricing_intro as string) || packagePrices,
    tagline: (v.brand_tagline as string | null) || null,
  };
}
