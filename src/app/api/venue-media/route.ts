import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  ensureVenueImagesBucket,
  isMediaLibraryPath,
  validateVenueMediaUpload,
  VENUE_IMAGES_BUCKET,
} from '@/lib/venue-images-bucket';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ASSET_COLUMNS =
  'id, storage_path, public_url, file_name, display_name, content_type, size_bytes, created_at, source_bucket';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('venue_media_assets')
    .select(ASSET_COLUMNS)
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[venue-media GET]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ assets: data ?? [] });
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    path?: string;
    publicUrl?: string;
    fileName?: string;
    contentType?: string;
    sizeBytes?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const path = body.path ?? '';
  const publicUrl = body.publicUrl ?? '';
  const fileName = body.fileName ?? '';
  const contentType = body.contentType ?? '';
  const sizeBytes = typeof body.sizeBytes === 'number' ? body.sizeBytes : 0;

  if (!path || !publicUrl || !fileName || !contentType) {
    return NextResponse.json(
      { error: 'path, publicUrl, fileName, and contentType are required' },
      { status: 400 },
    );
  }

  if (!isMediaLibraryPath(venueId, path)) {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 });
  }

  const invalid = validateVenueMediaUpload(contentType, sizeBytes);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  const ensured = await ensureVenueImagesBucket();
  if (!ensured.ok) {
    return NextResponse.json({ error: `Storage unavailable: ${ensured.error}` }, { status: 500 });
  }

  const { data: pub } = supabaseAdmin.storage.from(VENUE_IMAGES_BUCKET).getPublicUrl(path);
  if (pub.publicUrl !== publicUrl) {
    return NextResponse.json({ error: 'publicUrl does not match storage path' }, { status: 400 });
  }

  // Upsert on (venue_id, storage_path) so re-registering the same file (e.g. a
  // logo that was overwritten) refreshes metadata instead of 409-ing.
  const { data: row, error } = await supabaseAdmin
    .from('venue_media_assets')
    .upsert(
      {
        venue_id: venueId,
        storage_path: path,
        public_url: publicUrl,
        file_name: fileName,
        content_type: contentType,
        size_bytes: sizeBytes,
        source_bucket: VENUE_IMAGES_BUCKET,
      },
      { onConflict: 'venue_id,storage_path' },
    )
    .select(ASSET_COLUMNS)
    .single();

  if (error) {
    console.error('[venue-media POST]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ asset: row });
}
