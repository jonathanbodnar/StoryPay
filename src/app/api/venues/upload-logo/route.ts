import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  registerVenueMediaAsset,
  clearVenueMediaAssetsByPrefix,
} from '@/lib/venue-media-registry';

const LOGO_BUCKET = 'venue-assets';
const LOGO_MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
  }
  if (file.size > LOGO_MAX_BYTES) {
    return NextResponse.json({ error: 'File must be under 5MB' }, { status: 400 });
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const path = `venue-logos/${venueId}/logo.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  const { error: uploadError } = await supabaseAdmin.storage
    .from(LOGO_BUCKET)
    .upload(path, buffer, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadError) {
    if (uploadError.message?.includes('not found') || uploadError.message?.includes('does not exist')) {
      const { error: bucketError } = await supabaseAdmin.storage.createBucket(LOGO_BUCKET, {
        public: true,
        fileSizeLimit: LOGO_MAX_BYTES,
      });
      if (bucketError && !bucketError.message?.includes('already exists')) {
        console.error('[upload-logo] Bucket creation error:', bucketError);
        return NextResponse.json({ error: 'Storage not available. Please try the URL method.' }, { status: 500 });
      }
      const { error: retryError } = await supabaseAdmin.storage
        .from(LOGO_BUCKET)
        .upload(path, buffer, { contentType: file.type, upsert: true });
      if (retryError) {
        console.error('[upload-logo] Retry upload error:', retryError);
        return NextResponse.json({ error: retryError.message }, { status: 500 });
      }
    } else {
      console.error('[upload-logo] Upload error:', uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }
  }

  const { data: urlData } = supabaseAdmin.storage.from(LOGO_BUCKET).getPublicUrl(path);
  const publicUrl = urlData.publicUrl;

  await supabaseAdmin
    .from('venues')
    .update({ brand_logo_url: publicUrl })
    .eq('id', venueId);

  // Register the logo in the shared media library so it's reusable from the
  // Media page (and from emails/forms via the picker). Re-uploads with a
  // different extension would otherwise leave stale rows behind, so wipe any
  // prior `venue-logos/<venueId>/...` entries first.
  try {
    await clearVenueMediaAssetsByPrefix(venueId, LOGO_BUCKET, `venue-logos/${venueId}/`);
    await registerVenueMediaAsset({
      venueId,
      path,
      publicUrl,
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      sourceBucket: LOGO_BUCKET,
      displayName: 'Brand logo',
    });
  } catch (regErr) {
    // Best-effort: never fail the user-facing upload because of library sync.
    console.warn('[upload-logo] media library sync failed:', regErr);
  }

  return NextResponse.json({ url: publicUrl });
}
