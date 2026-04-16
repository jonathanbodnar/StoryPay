import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId, getMemberName } from '@/lib/auth-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from('customer_files')
    .select('*')
    .eq('customer_id', id)
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Generate signed URLs for each file
  const files = await Promise.all(
    (data ?? []).map(async (f) => {
      const { data: signed } = await supabaseAdmin.storage
        .from('customer-files')
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
  const fileType = (formData.get('file_type') as string) || 'other';
  const fileStatus = (formData.get('file_status') as string) || 'pending';

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const ext = file.name.split('.').pop() ?? 'bin';
  const storagePath = `${venueId}/${customerId}/${Date.now()}-${file.name.replace(/[^a-z0-9._-]/gi, '_')}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabaseAdmin.storage
    .from('customer-files')
    .upload(storagePath, arrayBuffer, { contentType: file.type || `application/${ext}`, upsert: false });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const authorName = await getMemberName();

  const { data, error } = await supabaseAdmin
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
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('customer_activity').insert({
    venue_id: venueId,
    customer_id: customerId,
    activity_type: 'file_uploaded',
    title: 'File uploaded',
    description: file.name,
  });

  const { data: signed } = await supabaseAdmin.storage
    .from('customer-files')
    .createSignedUrl(storagePath, 3600);

  return NextResponse.json({ ...data, url: signed?.signedUrl ?? null }, { status: 201 });
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

  const update: Record<string, unknown> = {};
  if (file_status) update.file_status = file_status;
  if (file_type)   update.file_type   = file_type;

  const { data, error } = await supabaseAdmin
    .from('customer_files')
    .update(update)
    .eq('id', fileId)
    .eq('customer_id', customerId)
    .eq('venue_id', venueId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: customerId } = await params;

  const { searchParams } = request.nextUrl;
  const fileId = searchParams.get('fileId');
  if (!fileId) return NextResponse.json({ error: 'fileId required' }, { status: 400 });

  const { data: fileRow } = await supabaseAdmin
    .from('customer_files')
    .select('storage_path')
    .eq('id', fileId)
    .eq('customer_id', customerId)
    .eq('venue_id', venueId)
    .single();

  if (fileRow?.storage_path) {
    await supabaseAdmin.storage.from('customer-files').remove([fileRow.storage_path]);
  }

  const { error } = await supabaseAdmin
    .from('customer_files')
    .delete()
    .eq('id', fileId)
    .eq('customer_id', customerId)
    .eq('venue_id', venueId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
