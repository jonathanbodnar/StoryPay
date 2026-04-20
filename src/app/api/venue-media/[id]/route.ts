import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isMediaLibraryPath, VENUE_IMAGES_BUCKET } from '@/lib/venue-images-bucket';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from('venue_media_assets')
    .select('id, storage_path')
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

  if (!isMediaLibraryPath(venueId, row.storage_path)) {
    return NextResponse.json({ error: 'Invalid asset path' }, { status: 400 });
  }

  const { error: rmErr } = await supabaseAdmin.storage.from(VENUE_IMAGES_BUCKET).remove([row.storage_path]);
  if (rmErr) {
    console.error('[venue-media DELETE] storage', rmErr.message);
    return NextResponse.json({ error: rmErr.message }, { status: 500 });
  }

  const { error: delErr } = await supabaseAdmin.from('venue_media_assets').delete().eq('id', id).eq('venue_id', venueId);

  if (delErr) {
    console.error('[venue-media DELETE] db', delErr.message);
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
