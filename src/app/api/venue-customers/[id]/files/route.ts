import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId, getMemberName } from '@/lib/auth-helpers';
import { checkUploadQuota, PER_FILE_MAX_BYTES } from '@/lib/venue-storage-quota';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'customer-files';

// Allowlist of MIME types accepted for customer file uploads.
// Deliberately excludes executables, scripts, office macros, and archives
// to prevent malware staging in customer records.
const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'image/heic', 'image/heif', 'image/svg+xml', 'image/tiff',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text
  'text/plain', 'text/csv',
  // Audio/video (venue recordings, walkthroughs)
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg',
  'video/mp4', 'video/quicktime', 'video/webm',
]);

// Lazily ensure the customer-files bucket exists so the first upload on a
// fresh project doesn't 500 with "Bucket not found".
async function ensureBucket() {
  const { data } = await supabaseAdmin.storage.getBucket(BUCKET);
  if (data) return;
  await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const { data: rows, error } = await supabaseAdmin
    .from('customer_files')
    .select('*')
    .eq('customer_id', id)
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[customer-files GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const files = await Promise.all(
    (rows ?? []).map(async (f) => {
      const { data: signed } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(f.storage_path, 3600);
      return { ...f, url: signed?.signedUrl ?? null };
    })
  );
  return NextResponse.json(files);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: customerId } = await params;

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const fileType   = (formData.get('file_type')   as string) || 'other';
  const fileStatus = (formData.get('file_status') as string) || 'pending';

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  if (file.size > PER_FILE_MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds the 50 MB per-file limit.' }, { status: 413 });
  }

  const mimeType = (file.type || '').toLowerCase().split(';')[0].trim();
  if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json(
      { error: `File type not allowed (${mimeType}). Accepted: images, PDF, Word, Excel, PowerPoint, CSV, text, audio, video.` },
      { status: 400 },
    );
  }

  // 5-file limit per lead/customer
  const { count: existingCount } = await supabaseAdmin
    .from('customer_files')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .eq('venue_id', venueId);

  if ((existingCount ?? 0) >= 5) {
    return NextResponse.json(
      { error: 'Lead attachments are limited to 5 files. Please remove an existing file to upload a new one.' },
      { status: 413 },
    );
  }

  const quotaError = await checkUploadQuota(venueId, file.size);
  if (quotaError) {
    return NextResponse.json({ error: quotaError, quotaExceeded: true }, { status: 413 });
  }

  try { await ensureBucket(); } catch (err) {
    console.error('[customer-files POST] ensureBucket', err);
  }

  const storagePath = `${venueId}/${customerId}/${Date.now()}-${file.name.replace(/[^a-z0-9._-]/gi, '_')}`;
  const arrayBuffer = await file.arrayBuffer();
  const ext = file.name.split('.').pop() ?? 'bin';

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || `application/${ext}`,
      upsert: false,
    });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const authorName = await getMemberName();

  const { data: row, error } = await supabaseAdmin
    .from('customer_files')
    .insert({
      venue_id: venueId,
      customer_id: customerId,
      filename: file.name,
      storage_path: storagePath,
      file_size: file.size,
      file_type: fileType,
      file_status: fileStatus,
      uploaded_by: authorName,
    })
    .select('*')
    .single();

  if (error || !row) {
    // Roll back the upload if the metadata insert failed.
    await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
    console.error('[customer-files POST insert]', error);
    return NextResponse.json({ error: error?.message ?? 'Failed to save file' }, { status: 500 });
  }

  await supabaseAdmin.from('customer_activity').insert({
    venue_id: venueId,
    customer_id: customerId,
    activity_type: 'file_uploaded',
    title: 'File uploaded',
    description: file.name,
  });

  const { data: signed } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600);

  return NextResponse.json({ ...row, url: signed?.signedUrl ?? null }, { status: 201 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: customerId } = await params;

  const { fileId, file_status, file_type } = await request.json();
  if (!fileId) return NextResponse.json({ error: 'fileId required' }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (file_status) updates.file_status = file_status;
  if (file_type)   updates.file_type   = file_type;

  if (Object.keys(updates).length === 0) {
    const { data: current } = await supabaseAdmin
      .from('customer_files')
      .select('*')
      .eq('id', fileId)
      .eq('customer_id', customerId)
      .eq('venue_id', venueId)
      .maybeSingle();
    return NextResponse.json(current ?? null);
  }

  const { data: row, error } = await supabaseAdmin
    .from('customer_files')
    .update(updates)
    .eq('id', fileId)
    .eq('customer_id', customerId)
    .eq('venue_id', venueId)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[customer-files PATCH]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(row);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: customerId } = await params;
  const fileId = request.nextUrl.searchParams.get('fileId');
  if (!fileId) return NextResponse.json({ error: 'fileId required' }, { status: 400 });

  const { data: fileRow } = await supabaseAdmin
    .from('customer_files')
    .select('storage_path')
    .eq('id', fileId)
    .eq('customer_id', customerId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (fileRow?.storage_path) {
    await supabaseAdmin.storage.from(BUCKET).remove([fileRow.storage_path]);
  }

  const { error } = await supabaseAdmin
    .from('customer_files')
    .delete()
    .eq('id', fileId)
    .eq('customer_id', customerId)
    .eq('venue_id', venueId);

  if (error) {
    console.error('[customer-files DELETE]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
