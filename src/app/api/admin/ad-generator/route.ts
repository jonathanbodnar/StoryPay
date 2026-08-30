export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getDbAsync } from '@/lib/db';
import { getAdminIdentity, hasAdminTabAccess } from '@/lib/admin-identity';
import { getVenueAdData } from '@/lib/ad-generator/venue-data';
import { generateAdCopy } from '@/lib/ad-generator/copy';
import { prepareCover, prepareLogo } from '@/lib/ad-generator/images';
import { renderAdCreative } from '@/lib/ad-generator/render';
import { HERO_SLOT } from '@/lib/ad-generator/templates';
import { AD_CREATIVES_BUCKET, adCreativeObjectKey, ensureAdCreativesBucket } from '@/lib/ad-creatives-bucket';
import type { AdCopyVariant } from '@/lib/ad-generator/spec';

const DIRECTORY_URL = process.env.NEXT_PUBLIC_DIRECTORY_URL ?? 'https://storyvenue.com';

// 1x1 warm-gray pixel so a template still renders if every photo fetch fails.
const FALLBACK_HERO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

interface CreativeRow {
  id: string;
  venue_id: string;
  variant: number;
  template_key: string | null;
  image_url: string | null;
  storage_path: string | null;
  headline: string | null;
  bullets: unknown;
  primary_text: string | null;
  meta_headline: string | null;
  description: string | null;
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
      SELECT id, venue_id, variant, template_key, image_url, storage_path,
             headline, bullets, primary_text, meta_headline, description,
             destination_url, created_at
      FROM venue_ad_creatives
      WHERE venue_id = ${venueId}
      ORDER BY created_at DESC, variant ASC
      LIMIT 30
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

  let body: { venueId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const venueId = (body.venueId || '').trim();
  if (!venueId) return NextResponse.json({ error: 'venueId required' }, { status: 400 });

  const data = await getVenueAdData(venueId);
  if (!data) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  if (data.photos.length === 0) {
    return NextResponse.json(
      { error: 'This venue has no photos yet. Add photos to the listing or pricing guide first.' },
      { status: 422 },
    );
  }

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
  const creatives: Array<CreativeRow & { imageBullets: string[] }> = [];

  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    const slot = HERO_SLOT[variant.templateKey];

    // Give each variant a different hero photo when the venue has several.
    let heroDataUrl: string | null = null;
    for (let p = 0; p < data.photos.length && !heroDataUrl; p++) {
      const url = data.photos[(i + p) % data.photos.length];
      heroDataUrl = await prepareCover(url, slot.w, slot.h);
    }

    let imageUrl: string | null = null;
    let storagePath: string | null = null;
    try {
      const png = await renderAdCreative(variant.templateKey, {
        venue: data,
        variant,
        heroDataUrl: heroDataUrl ?? FALLBACK_HERO,
        logoDataUrl,
      });
      const key = adCreativeObjectKey(venueId, batchId, i + 1, variant.templateKey);
      const { error: upErr } = await supabaseAdmin.storage
        .from(AD_CREATIVES_BUCKET)
        .upload(key, png, { contentType: 'image/png', upsert: true });
      if (upErr) throw new Error(upErr.message);
      storagePath = key;
      imageUrl = supabaseAdmin.storage.from(AD_CREATIVES_BUCKET).getPublicUrl(key).data.publicUrl;
    } catch (err) {
      console.error('[admin/ad-generator] render/upload failed', err instanceof Error ? err.message : err);
      // Keep going — copy is still valuable even if one image fails.
    }

    let inserted: CreativeRow | null = null;
    try {
      const rows = (await sql`
        INSERT INTO venue_ad_creatives
          (venue_id, variant, template_key, image_url, storage_path, headline,
           bullets, primary_text, meta_headline, description, destination_url, created_by)
        VALUES
          (${venueId}, ${i + 1}, ${variant.templateKey}, ${imageUrl}, ${storagePath},
           ${variant.imageHeadline}, ${sql.json(variant.imageBullets)}, ${variant.primaryText},
           ${variant.metaHeadline}, ${variant.description}, ${destinationUrl}, ${createdBy})
        RETURNING id, venue_id, variant, template_key, image_url, storage_path, headline,
                  bullets, primary_text, meta_headline, description, destination_url, created_at
      `) as unknown as CreativeRow[];
      inserted = rows[0] ?? null;
    } catch (err) {
      console.error('[admin/ad-generator] insert failed', err instanceof Error ? err.message : err);
    }

    creatives.push({
      id: inserted?.id ?? `${batchId}-${i + 1}`,
      venue_id: venueId,
      variant: i + 1,
      template_key: variant.templateKey,
      image_url: imageUrl,
      storage_path: storagePath,
      headline: variant.imageHeadline,
      bullets: variant.imageBullets,
      imageBullets: variant.imageBullets,
      primary_text: variant.primaryText,
      meta_headline: variant.metaHeadline,
      description: variant.description,
      destination_url: destinationUrl,
      created_at: inserted?.created_at ?? new Date().toISOString(),
    });
  }

  return NextResponse.json({ batchId, creatives });
}
