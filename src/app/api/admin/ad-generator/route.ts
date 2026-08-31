export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getDbAsync } from '@/lib/db';
import { getAdminIdentity, hasAdminTabAccess } from '@/lib/admin-identity';
import { getVenueAdData } from '@/lib/ad-generator/venue-data';
import { selectAdPhotos } from '@/lib/ad-generator/photo-select';
import { generateAdCopy } from '@/lib/ad-generator/copy';
import { fetchImageBuffer, prepareCoverFromBuffer, prepareLogo } from '@/lib/ad-generator/images';
import { renderAdCreative } from '@/lib/ad-generator/render';
import { generateAdImage } from '@/lib/ad-generator/image-gen';
import { TEMPLATE_SLOTS } from '@/lib/ad-generator/templates';
import { AD_CREATIVES_BUCKET } from '@/lib/ad-creatives-bucket';
import type { AdCopyVariant } from '@/lib/ad-generator/spec';

const DIRECTORY_URL = process.env.NEXT_PUBLIC_DIRECTORY_URL ?? 'https://storyvenue.com';

// 1x1 warm-gray pixel so a template still renders if every photo fetch fails.
const FALLBACK_HERO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Shape returned to the client. Images are inline data URIs — nothing is stored. */
interface EphemeralCreative {
  id: string;
  variant: number;
  template_key: string;
  image: string | null;
  /** The pre-cropped slot photos used, so an edited creative can be re-rendered
   *  without re-downloading/re-cropping the venue's photos. */
  slot_images: string[];
  headline: string;
  bullets: string[];
  image_cta: string;
  primary_text: string;
  meta_headline: string;
  destination_url: string | null;
}

function pngDataUrl(buf: Buffer | Uint8Array | null): string | null {
  if (!buf) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return `data:image/png;base64,${b.toString('base64')}`;
}

/**
 * GET
 *   ?venueId=&candidates=1 → the venue's candidate photos (for the media picker).
 * (Creatives are never persisted, so there is no "list past creatives" mode.)
 */
export async function GET(request: NextRequest) {
  if (!(await hasAdminTabAccess('projects'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const venueId = (request.nextUrl.searchParams.get('venueId') || '').trim();
  if (!venueId) return NextResponse.json({ error: 'venueId required' }, { status: 400 });

  try {
    const data = await getVenueAdData(venueId);
    if (!data) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    return NextResponse.json({ photos: data.photos, logoUrl: data.logoUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin/ad-generator][GET]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE ?venueId= → wipe any previously stored creatives for the venue (rows +
 *  storage). Called when the Ad Studio modal closes so nothing lingers. */
export async function DELETE(request: NextRequest) {
  if (!(await hasAdminTabAccess('projects'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const venueId = (request.nextUrl.searchParams.get('venueId') || '').trim();
  if (!venueId) return NextResponse.json({ error: 'venueId required' }, { status: 400 });
  await purgeVenueCreatives(venueId);
  return NextResponse.json({ ok: true });
}

/** Best-effort removal of any stored creatives (legacy rows + storage objects). */
async function purgeVenueCreatives(venueId: string): Promise<void> {
  try {
    const sql = await getDbAsync();
    const oldRows = (await sql`
      SELECT storage_path FROM venue_ad_creatives WHERE venue_id = ${venueId}
    `) as unknown as { storage_path: string | null }[];
    const paths = oldRows.map((r) => r.storage_path).filter((p): p is string => Boolean(p));
    if (paths.length) await supabaseAdmin.storage.from(AD_CREATIVES_BUCKET).remove(paths);
    await sql`DELETE FROM venue_ad_creatives WHERE venue_id = ${venueId}`;
  } catch (e) {
    // Table may not exist / already empty — nothing to clean up.
    console.warn('[admin/ad-generator] purge skipped', e instanceof Error ? e.message : e);
  }
}

/** POST { venueId, mode?, photos? } → generate 6 creatives + copy, return inline.
 *  Nothing is written to the DB or storage — the images live only in the
 *  response and are gone the moment the modal closes. */
export async function POST(request: NextRequest) {
  const identity = await getAdminIdentity();
  if (!identity.allowedTabs.has('projects')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { venueId?: string; mode?: string; photos?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const venueId = (body.venueId || '').trim();
  if (!venueId) return NextResponse.json({ error: 'venueId required' }, { status: 400 });
  // 'ai' → gpt-image-2 designs the creative from the real photos;
  // 'template' (default) → Satori composites real photos into the fixed layout.
  const mode = (body.mode || 'template').toLowerCase() === 'ai' ? 'ai' : 'template';
  // Optional operator override: exact photos hand-picked from the media folder.
  const overridePhotos = Array.isArray(body.photos)
    ? body.photos.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : [];

  const data = await getVenueAdData(venueId);
  if (!data) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  // Non-null alias so TS keeps the narrowing inside the async closures below.
  const venue = data;
  const destinationUrl = venue.slug ? `${DIRECTORY_URL}/venue/${venue.slug}` : null;

  // Kick off the slow, independent work up front so it runs CONCURRENTLY with the
  // photo vetting + downloads below: Claude writes the copy and the logo is
  // prepped while we pick and fetch photos. Neither depends on the photo list.
  // (Both resolve without throwing, so an early return can't leave them unhandled.)
  const copyPromise = generateAdCopy(venue);
  const logoPromise = venue.logoUrl ? prepareLogo(venue.logoUrl, 300, 112) : Promise.resolve(null);

  // Photo source: operator override wins; otherwise vision-vet the venue's photos.
  if (overridePhotos.length > 0) {
    venue.photos = overridePhotos;
  } else {
    if (venue.photos.length === 0) {
      return NextResponse.json(
        { error: 'This venue has no photos yet. Add photos to the listing or pricing guide first.' },
        { status: 422 },
      );
    }
    venue.photos = await selectAdPhotos(venue.photos);
  }
  if (venue.photos.length === 0) {
    return NextResponse.json({ error: 'No usable photos selected.' }, { status: 422 });
  }

  // Fetch every source photo exactly ONCE (parallel), then crop from the decoded
  // buffer for each slot — the old code re-downloaded the same photo up to 18×,
  // which is what made generation time out.
  const buffers = await Promise.all(venue.photos.map((u) => fetchImageBuffer(u)));

  // Copy always resolves (falls back internally) so this never blocks the batch.
  const variants: AdCopyVariant[] = await copyPromise;
  const logoDataUrl = await logoPromise;
  const cropCache = new Map<string, Promise<string | null>>();
  const crop = (idx: number, w: number, h: number): Promise<string | null> => {
    const key = `${idx}:${w}x${h}`;
    let p = cropCache.get(key);
    if (!p) {
      const buf = buffers[idx];
      p = buf ? prepareCoverFromBuffer(buf, w, h) : Promise.resolve(null);
      cropCache.set(key, p);
    }
    return p;
  };

  async function buildTemplate(variant: AdCopyVariant, i: number): Promise<{ png: Buffer | null; slotImages: string[] }> {
    const slots = TEMPLATE_SLOTS[variant.templateKey] ?? TEMPLATE_SLOTS.editorial;
    const n = venue.photos.length;
    const slotImages: string[] = [];
    const usedIdx = new Set<number>();

    for (let sIdx = 0; sIdx < slots.length; sIdx++) {
      const { w, h } = slots[sIdx];
      let dataUrl: string | null = null;
      // Prefer a DIFFERENT photo per slot within the same ad.
      for (let step = 0; step < n && !dataUrl; step++) {
        const idx = (i + sIdx + step) % n;
        if (usedIdx.has(idx) || !buffers[idx]) continue;
        dataUrl = await crop(idx, w, h);
        if (dataUrl) usedIdx.add(idx);
      }
      // Fallback: allow reuse before a blank slot.
      for (let step = 0; step < n && !dataUrl; step++) {
        const idx = (i + sIdx + step) % n;
        if (!buffers[idx]) continue;
        dataUrl = await crop(idx, w, h);
      }
      slotImages.push(dataUrl ?? FALLBACK_HERO);
    }

    let png: Buffer | null = null;
    try {
      png = await renderAdCreative(variant.templateKey, { venue, variant, images: slotImages, logoDataUrl });
    } catch (err) {
      console.error('[admin/ad-generator] render failed', err instanceof Error ? err.message : err);
    }
    return { png, slotImages };
  }

  let built: { png: Buffer | null; slotImages: string[] }[];
  if (mode === 'ai') {
    built = await Promise.all(
      variants.map((variant, i) => {
        const refs = [...venue.photos.slice(i), ...venue.photos.slice(0, i)];
        return generateAdImage(venue, variant, refs)
          .then((png) => ({ png, slotImages: [] as string[] }))
          .catch((e) => {
            console.error('[admin/ad-generator] ai image failed', e instanceof Error ? e.message : e);
            return { png: null as Buffer | null, slotImages: [] as string[] };
          });
      }),
    );
  } else {
    built = await Promise.all(variants.map((variant, i) => buildTemplate(variant, i)));
  }

  const creatives: EphemeralCreative[] = variants.map((variant, i) => ({
    id: `${i + 1}`,
    variant: i + 1,
    template_key: variant.templateKey,
    image: pngDataUrl(built[i]?.png ?? null),
    slot_images: built[i]?.slotImages ?? [],
    headline: variant.imageHeadline,
    bullets: variant.imageBullets,
    image_cta: variant.imageCta,
    primary_text: variant.primaryText,
    meta_headline: variant.metaHeadline,
    destination_url: destinationUrl,
  }));

  return NextResponse.json({ creatives });
}
