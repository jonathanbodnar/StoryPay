import { NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One-off maintenance: scrub venue image references that point at storage
 * objects which no longer exist (HTTP 404). This happens when a photo is
 * deleted from storage but the venue's cover_image_url / gallery_images still
 * reference it, leaving broken <img> tags on the public listing page.
 *
 * Prevention is already in place (the venue-media DELETE route now scrubs
 * references), so this only heals historical rows. Safe to re-run.
 *
 * GET  ?dry=1  -> preview only, no writes
 * POST         -> apply the cleanup
 */
const VENUE_IMAGES_MARKER = '/venue-images/';

async function urlIsAlive(url: string, cache: Map<string, boolean>): Promise<boolean> {
  if (cache.has(url)) return cache.get(url)!;
  let alive = true;
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    // Only treat a definitive 404/NoSuchKey as dead. Transient 5xx are kept.
    alive = res.status !== 404 && res.status !== 400;
  } catch {
    alive = true; // network hiccup — err on the side of keeping the reference
  }
  cache.set(url, alive);
  return alive;
}

async function run(dryRun: boolean) {
  const { data: venues, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, slug, cover_image_url, gallery_images, brand_logo_url');

  if (error) {
    return { error: error.message, status: 500 as const };
  }

  const cache = new Map<string, boolean>();
  const changed: Array<{
    slug: string | null;
    name: string | null;
    removedFromGallery: number;
    coverReset: boolean;
    logoCleared: boolean;
  }> = [];

  for (const v of venues ?? []) {
    const gallery: string[] = Array.isArray(v.gallery_images) ? (v.gallery_images as string[]) : [];
    const updates: Record<string, unknown> = {};

    // Gallery: keep anything that isn't a venue-images URL, or that is still alive.
    const keptGallery: string[] = [];
    let removedFromGallery = 0;
    for (const url of gallery) {
      if (typeof url !== 'string' || !url.includes(VENUE_IMAGES_MARKER)) {
        keptGallery.push(url);
        continue;
      }
      if (await urlIsAlive(url, cache)) keptGallery.push(url);
      else removedFromGallery += 1;
    }
    if (removedFromGallery > 0) updates.gallery_images = keptGallery;

    // Cover: if it's a dead venue-images URL, reset to the first surviving photo.
    let coverReset = false;
    const cover = v.cover_image_url as string | null;
    if (cover && cover.includes(VENUE_IMAGES_MARKER) && !(await urlIsAlive(cover, cache))) {
      updates.cover_image_url = keptGallery[0] ?? null;
      coverReset = true;
    }

    // Brand logo: clear if dead.
    let logoCleared = false;
    const logo = v.brand_logo_url as string | null;
    if (logo && logo.includes(VENUE_IMAGES_MARKER) && !(await urlIsAlive(logo, cache))) {
      updates.brand_logo_url = null;
      logoCleared = true;
    }

    if (Object.keys(updates).length === 0) continue;

    changed.push({
      slug: v.slug ?? null,
      name: v.name ?? null,
      removedFromGallery,
      coverReset,
      logoCleared,
    });

    if (!dryRun) {
      await supabaseAdmin.from('venues').update(updates).eq('id', v.id);
    }
  }

  return {
    status: 200 as const,
    dryRun,
    venuesScanned: venues?.length ?? 0,
    venuesChanged: changed.length,
    changed,
  };
}

export async function GET(req: Request) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = new URL(req.url).searchParams.get('dry') !== '0';
  const result = await run(dry);
  const { status, ...body } = result as { status: number } & Record<string, unknown>;
  return NextResponse.json(body, { status });
}

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await run(false);
  const { status, ...body } = result as { status: number } & Record<string, unknown>;
  return NextResponse.json(body, { status });
}
