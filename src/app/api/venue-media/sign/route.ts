import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  ensureVenueImagesBucket,
  mediaLibraryObjectKey,
  validateVenueImageUpload,
  VENUE_IMAGES_BUCKET,
} from '@/lib/venue-images-bucket';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { fileName?: string; contentType?: string; size?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const fileName = body.fileName ?? '';
  const contentType = body.contentType ?? '';
  const size = typeof body.size === 'number' ? body.size : 0;

  if (!fileName || !contentType) {
    return NextResponse.json({ error: 'fileName and contentType required' }, { status: 400 });
  }

  const invalid = validateVenueImageUpload(contentType, size);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  const ensured = await ensureVenueImagesBucket();
  if (!ensured.ok) {
    console.error('[venue-media/sign] ensureVenueImagesBucket failed:', ensured.error);
    return NextResponse.json(
      { error: `Storage bucket unavailable: ${ensured.error}` },
      { status: 500 },
    );
  }

  const objectKey = mediaLibraryObjectKey(venueId, fileName);

  const { data, error } = await supabaseAdmin.storage.from(VENUE_IMAGES_BUCKET).createSignedUploadUrl(objectKey);

  if (error || !data) {
    console.error('[venue-media/sign] createSignedUploadUrl failed:', error?.message);
    return NextResponse.json({ error: error?.message ?? 'Failed to create upload URL' }, { status: 500 });
  }

  const { data: pub } = supabaseAdmin.storage.from(VENUE_IMAGES_BUCKET).getPublicUrl(objectKey);

  return NextResponse.json({
    bucket: VENUE_IMAGES_BUCKET,
    path: objectKey,
    token: data.token,
    signedUrl: data.signedUrl,
    publicUrl: pub.publicUrl,
  });
}
