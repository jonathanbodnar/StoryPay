import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { VENUE_IMAGES_BUCKET } from '@/lib/venue-images-bucket';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: { displayName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const raw = (body.displayName ?? '').trim();
  if (!raw) {
    return NextResponse.json({ error: 'displayName is required' }, { status: 400 });
  }
  if (raw.length > 200) {
    return NextResponse.json({ error: 'Name must be 200 characters or fewer' }, { status: 400 });
  }

  // Display-name only — we never touch storage_path / public_url so existing
  // links across the product (listing, branding, emails, forms) keep working.
  const { data: row, error } = await supabaseAdmin
    .from('venue_media_assets')
    .update({ display_name: raw })
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('id, storage_path, public_url, file_name, display_name, content_type, size_bytes, created_at, source_bucket')
    .maybeSingle();

  if (error) {
    console.error('[venue-media PATCH]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ asset: row });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from('venue_media_assets')
    .select('id, storage_path, source_bucket, public_url')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (fetchErr) {
    console.error('[venue-media DELETE] fetch', fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Tenancy guard: storage paths always begin with the venue id (or, for
  // legacy logos, with `venue-logos/<venueId>/`). Reject anything else so a
  // crafted DB row can never delete another tenant's file.
  const path = row.storage_path as string;
  const bucket = (row.source_bucket as string | null) ?? VENUE_IMAGES_BUCKET;
  const tenantOk =
    path.startsWith(`${venueId}/`) || path.startsWith(`venue-logos/${venueId}/`);
  if (!tenantOk) {
    return NextResponse.json({ error: 'Invalid asset path' }, { status: 400 });
  }

  const { error: rmErr } = await supabaseAdmin.storage.from(bucket).remove([path]);
  if (rmErr) {
    console.error('[venue-media DELETE] storage', rmErr.message);
    return NextResponse.json({ error: rmErr.message }, { status: 500 });
  }

  const { error: delErr } = await supabaseAdmin
    .from('venue_media_assets')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId);

  if (delErr) {
    console.error('[venue-media DELETE] db', delErr.message);
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // Best-effort cleanup of references on the venue record. If we just deleted
  // the file the brand logo / cover / gallery pointed at, clear those columns
  // so the dashboard doesn't render broken images. Non-fatal on failure.
  try {
    const publicUrl = row.public_url as string | null;
    if (publicUrl) {
      const { data: venue } = await supabaseAdmin
        .from('venues')
        .select('brand_logo_url, cover_image_url, gallery_images')
        .eq('id', venueId)
        .maybeSingle();
      if (venue) {
        const updates: Record<string, unknown> = {};
        if (venue.brand_logo_url === publicUrl) updates.brand_logo_url = null;
        if (venue.cover_image_url === publicUrl) updates.cover_image_url = null;
        if (Array.isArray(venue.gallery_images) && venue.gallery_images.includes(publicUrl)) {
          updates.gallery_images = (venue.gallery_images as string[]).filter((u) => u !== publicUrl);
        }
        if (Object.keys(updates).length > 0) {
          await supabaseAdmin.from('venues').update(updates).eq('id', venueId);
        }
      }
    }
  } catch (cleanupErr) {
    console.warn('[venue-media DELETE] reference cleanup warning:', cleanupErr);
  }

  return NextResponse.json({ ok: true });
}
