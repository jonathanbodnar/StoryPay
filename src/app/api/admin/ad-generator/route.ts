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
import { prepareCover, prepareLogo } from '@/lib/ad-generator/images';
import { renderAdCreative } from '@/lib/ad-generator/render';
import { generateAdImage } from '@/lib/ad-generator/image-gen';
import { TEMPLATE_SLOTS } from '@/lib/ad-generator/templates';
import { AD_CREATIVES_BUCKET, adCreativeObjectKey, ensureAdCreativesBucket } from '@/lib/ad-creatives-bucket';
import type { AdCopyVariant } from '@/lib/ad-generator/spec';

const DIRECTORY_URL = process.env.NEXT_PUBLIC_DIRECTORY_URL ?? 'https://storyvenue.com';

// 1x1 warm-gray pixel so a template still renders if every photo fetch fails.
const FALLBACK_HERO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

interface CreativeRow {
  id: string;
  venue_id: string;
  batch_id: string | null;
  variant: number;
  template_key: string | null;
  image_url: string | null;
  storage_path: string | null;
  headline: string | null;
  bullets: unknown;
  primary_text: string | null;
  meta_headline: string | null;
  destination_url: string | null;
  created_at: string;
}

/** GET ?venueId= → most recent generated creatives for a venue. */
export async function GET(request: NextRequest) {
  if (!(await hasAdminTabAccess('projects'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const venueId = (request.nextUrl.searchParams.get('venueId') || '').trim();
  if (!venueId) return NextResponse.json({ error: 'venueId required' }, { status: 400 });

  try {
    const sql = await getDbAsync();
    const rows = (await sql`
      SELECT id, venue_id, batch_id, variant, template_key, image_url, storage_path,
             headline, bullets, primary_text, meta_headline,
             destination_url, created_at
      FROM venue_ad_creatives
      WHERE venue_id = ${venueId}
      ORDER BY created_at DESC, variant ASC
      LIMIT 120
    `) as unknown as CreativeRow[];
    return NextResponse.json({ creatives: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin/ad-generator][GET]', msg);
    if (/venue_ad_creatives/.test(msg)) {
      return NextResponse.json({ error: 'Ad schema not found — run migration 207.', detail: msg }, { status: 503 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** POST { venueId } → generate 3 copy + creative variants, store, return them. */
export async function POST(request: NextRequest) {
  const identity = await getAdminIdentity();
  if (!identity.allowedTabs.has('projects')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { venueId?: string; mode?: string };
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

  const data = await getVenueAdData(venueId);
  if (!data) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  if (data.photos.length === 0) {
    return NextResponse.json(
      { error: 'This venue has no photos yet. Add photos to the listing or pricing guide first.' },
      { status: 422 },
    );
  }

  // Vet the photos with vision so only brides/grooms, wedding moments and
  // property shots make it in — no table settings, food or construction.
  data.photos = await selectAdPhotos(data.photos);

  const bucket = await ensureAdCreativesBucket();
  if (!bucket.ok) {
    return NextResponse.json({ error: `Storage unavailable: ${bucket.error}` }, { status: 500 });
  }

  const createdBy = identity.isMasterSuperAdmin ? 'master' : identity.member?.email ?? null;
  const destinationUrl = data.slug ? `${DIRECTORY_URL}/venue/${data.slug}` : null;

  let variants: AdCopyVariant[];
  try {
    variants = await generateAdCopy(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin/ad-generator] copy failed', msg);
    return NextResponse.json({ error: `Copy generation failed: ${msg}` }, { status: 500 });
  }

  const logoDataUrl = data.logoUrl ? await prepareLogo(data.logoUrl, 300, 112) : null;
  const batchId = crypto.randomUUID();

  const sql = await getDbAsync();

  // Only ever keep the latest generation: wipe the venue's previous creatives
  // (DB rows + stored images) before writing the new batch.
  try {
    const oldRows = (await sql`
      SELECT storage_path FROM venue_ad_creatives WHERE venue_id = ${venueId}
    `) as unknown as { storage_path: string | null }[];
    const paths = oldRows.map((r) => r.storage_path).filter((p): p is string => Boolean(p));
    if (paths.length) await supabaseAdmin.storage.from(AD_CREATIVES_BUCKET).remove(paths);
    await sql`DELETE FROM venue_ad_creatives WHERE venue_id = ${venueId}`;
  } catch (e) {
    console.warn('[admin/ad-generator] failed clearing old creatives', e instanceof Error ? e.message : e);
  }

  const creatives: Array<CreativeRow & { imageBullets: string[] }> = [];

  // AI mode: fire all 6 gpt-image-2 designs in parallel (each is slow), feeding
  // a rotated slice of the vetted photos so every creative leans on the real
  // venue and the batch stays varied.
  const aiPngs: (Buffer | null)[] =
    mode === 'ai'
      ? await Promise.all(
          variants.map((variant, i) => {
            const refs = [...data.photos.slice(i), ...data.photos.slice(0, i)];
            return generateAdImage(data, variant, refs).catch((e) => {
              console.error('[admin/ad-generator] ai image failed', e instanceof Error ? e.message : e);
              return null;
            });
          }),
        )
      : [];

  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];

    // Compute the creative PNG for this variant via the selected mode.
    let png: Buffer | Uint8Array | null = null;
    if (mode === 'ai') {
      png = aiPngs[i];
    } else {
      const slots = TEMPLATE_SLOTS[variant.templateKey] ?? TEMPLATE_SLOTS.editorial;

      // Fill each photo slot. Within ONE ad every slot must be a DIFFERENT photo,
      // so track used indices and only reuse as a last resort. A per-variant offset
      // also keeps the batch's creatives featuring different heroes.
      const images: string[] = [];
      const usedIdx = new Set<number>();
      for (let sIdx = 0; sIdx < slots.length; sIdx++) {
        let dataUrl: string | null = null;
        for (let step = 0; step < data.photos.length && !dataUrl; step++) {
          const idx = (i + sIdx + step) % data.photos.length;
          if (usedIdx.has(idx)) continue;
          dataUrl = await prepareCover(data.photos[idx], slots[sIdx].w, slots[sIdx].h);
          if (dataUrl) usedIdx.add(idx);
        }
        // Fallback: if every unused photo failed to decode, allow reuse over blank.
        for (let step = 0; step < data.photos.length && !dataUrl; step++) {
          const idx = (i + sIdx + step) % data.photos.length;
          dataUrl = await prepareCover(data.photos[idx], slots[sIdx].w, slots[sIdx].h);
        }
        images.push(dataUrl ?? FALLBACK_HERO);
      }

      try {
        png = await renderAdCreative(variant.templateKey, {
          venue: data,
          variant,
          images,
          logoDataUrl,
        });
      } catch (err) {
        console.error('[admin/ad-generator] render failed', err instanceof Error ? err.message : err);
      }
    }

    let imageUrl: string | null = null;
    let storagePath: string | null = null;
    if (png) {
      try {
        const key = adCreativeObjectKey(venueId, batchId, i + 1, mode === 'ai' ? 'ai' : variant.templateKey);
        const { error: upErr } = await supabaseAdmin.storage
          .from(AD_CREATIVES_BUCKET)
          .upload(key, png, { contentType: 'image/png', upsert: true });
        if (upErr) throw new Error(upErr.message);
        storagePath = key;
        imageUrl = supabaseAdmin.storage.from(AD_CREATIVES_BUCKET).getPublicUrl(key).data.publicUrl;
      } catch (err) {
        console.error('[admin/ad-generator] upload failed', err instanceof Error ? err.message : err);
        // Keep going — copy is still valuable even if one image fails.
      }
    }

    let inserted: CreativeRow | null = null;
    try {
      const rows = (await sql`
        INSERT INTO venue_ad_creatives
          (venue_id, batch_id, variant, template_key, image_url, storage_path, headline,
           bullets, primary_text, meta_headline, destination_url, created_by)
        VALUES
          (${venueId}, ${batchId}, ${i + 1}, ${variant.templateKey}, ${imageUrl}, ${storagePath},
           ${variant.imageHeadline}, ${sql.json(variant.imageBullets)}, ${variant.primaryText},
           ${variant.metaHeadline}, ${destinationUrl}, ${createdBy})
        RETURNING id, venue_id, batch_id, variant, template_key, image_url, storage_path, headline,
                  bullets, primary_text, meta_headline, destination_url, created_at
      `) as unknown as CreativeRow[];
      inserted = rows[0] ?? null;
    } catch (err) {
      console.error('[admin/ad-generator] insert failed', err instanceof Error ? err.message : err);
    }

    creatives.push({
      id: inserted?.id ?? `${batchId}-${i + 1}`,
      venue_id: venueId,
      batch_id: batchId,
      variant: i + 1,
      template_key: variant.templateKey,
      image_url: imageUrl,
      storage_path: storagePath,
      headline: variant.imageHeadline,
      bullets: variant.imageBullets,
      imageBullets: variant.imageBullets,
      primary_text: variant.primaryText,
      meta_headline: variant.metaHeadline,
      destination_url: destinationUrl,
      created_at: inserted?.created_at ?? new Date().toISOString(),
    });
  }

  return NextResponse.json({ batchId, creatives });
}
