import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId, getMemberName } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'customer-files';
const SIGNED_TTL_SEC = 60 * 60 * 24 * 7; // 7 days — long enough for recipient to open from SMS

async function ensureBucket() {
  const { data } = await supabaseAdmin.storage.getBucket(BUCKET);
  if (data) return;
  await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { threadId } = await params;
  const { data: thread, error: tErr } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, venue_customer_id')
    .eq('id', threadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (tErr) {
    console.error('[sms-attachment]', tErr);
    return NextResponse.json({ error: tErr.message }, { status: 500 });
  }
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const customerId = thread.venue_customer_id as string;

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  try {
    await ensureBucket();
  } catch (err) {
    console.error('[sms-attachment] ensureBucket', err);
  }

  const storagePath = `${venueId}/${customerId}/${Date.now()}-${file.name.replace(/[^a-z0-9._-]/gi, '_')}`;
  const arrayBuffer = await file.arrayBuffer();
  const ext = file.name.split('.').pop() ?? 'bin';

  const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(storagePath, arrayBuffer, {
    contentType: file.type || `application/${ext}`,
    upsert: false,
  });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const authorName = await getMemberName();

  const { data: row, error: insErr } = await supabaseAdmin
    .from('customer_files')
    .insert({
      venue_id: venueId,
      customer_id: customerId,
      filename: file.name,
      storage_path: storagePath,
      file_size: file.size,
      file_type: 'other',
      file_status: 'pending',
      uploaded_by: authorName,
    })
    .select('id, filename')
    .single();

  if (insErr || !row) {
    await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
    console.error('[sms-attachment] insert', insErr);
    return NextResponse.json({ error: insErr?.message ?? 'Failed to save file' }, { status: 500 });
  }

  await supabaseAdmin.from('customer_activity').insert({
    venue_id: venueId,
    customer_id: customerId,
    activity_type: 'file_uploaded',
    title: 'File shared in SMS',
    description: file.name,
  });

  const { data: signed } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_TTL_SEC);

  if (!signed?.signedUrl) {
    return NextResponse.json({ error: 'Could not create download link' }, { status: 500 });
  }

  return NextResponse.json({
    url: signed.signedUrl,
    filename: file.name,
    file_id: row.id,
  });
}
