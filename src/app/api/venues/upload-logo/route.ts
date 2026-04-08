import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'File must be under 5MB' }, { status: 400 });

  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const path = `venue-logos/${venueId}/logo.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  // Upload to Supabase Storage (public bucket: 'venue-assets')
  const { error: uploadError } = await supabaseAdmin.storage
    .from('venue-assets')
    .upload(path, buffer, {
      contentType: file.type,
      upsert: true, // overwrite existing logo
    });

  if (uploadError) {
    // If bucket doesn't exist, try creating it first
    if (uploadError.message?.includes('not found') || uploadError.message?.includes('does not exist')) {
      const { error: bucketError } = await supabaseAdmin.storage.createBucket('venue-assets', {
        public: true,
        fileSizeLimit: 5242880,
      });
      if (bucketError && !bucketError.message?.includes('already exists')) {
        console.error('[upload-logo] Bucket creation error:', bucketError);
        return NextResponse.json({ error: 'Storage not available. Please try the URL method.' }, { status: 500 });
      }
      // Retry upload
      const { error: retryError } = await supabaseAdmin.storage
        .from('venue-assets')
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

  // Get public URL
  const { data: urlData } = supabaseAdmin.storage
    .from('venue-assets')
    .getPublicUrl(path);

  const publicUrl = urlData.publicUrl;

  // Save to venue record
  await supabaseAdmin
    .from('venues')
    .update({ brand_logo_url: publicUrl })
    .eq('id', venueId);

  return NextResponse.json({ url: publicUrl });
}
