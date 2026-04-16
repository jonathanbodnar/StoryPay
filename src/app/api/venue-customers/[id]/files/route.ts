import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getDb } from '@/lib/db';
import { getVenueId, getMemberName } from '@/lib/auth-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const sql = getDb();
    const rows = await sql`
      SELECT * FROM customer_files
      WHERE customer_id = ${id} AND venue_id = ${venueId}
      ORDER BY created_at DESC
    `;

    const files = await Promise.all(
      rows.map(async (f) => {
        const { data: signed } = await supabaseAdmin.storage
          .from('customer-files')
          .createSignedUrl(f.storage_path, 3600);
        return { ...f, url: signed?.signedUrl ?? null };
      })
    );
    return NextResponse.json(files);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
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

  const storagePath = `${venueId}/${customerId}/${Date.now()}-${file.name.replace(/[^a-z0-9._-]/gi, '_')}`;
  const arrayBuffer = await file.arrayBuffer();
  const ext = file.name.split('.').pop() ?? 'bin';

  const { error: uploadError } = await supabaseAdmin.storage
    .from('customer-files')
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || `application/${ext}`,
      upsert: false,
    });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const authorName = await getMemberName();

  try {
    const sql = getDb();
    const [row] = await sql`
      INSERT INTO customer_files
        (venue_id, customer_id, filename, storage_path, file_size, file_type, file_status, uploaded_by)
      VALUES
        (${venueId}, ${customerId}, ${file.name}, ${storagePath}, ${file.size},
         ${fileType}, ${fileStatus}, ${authorName})
      RETURNING *
    `;
    await sql`
      INSERT INTO customer_activity (venue_id, customer_id, activity_type, title, description)
      VALUES (${venueId}, ${customerId}, 'file_uploaded', 'File uploaded', ${file.name})
    `;

    const { data: signed } = await supabaseAdmin.storage
      .from('customer-files')
      .createSignedUrl(storagePath, 3600);

    return NextResponse.json({ ...row, url: signed?.signedUrl ?? null }, { status: 201 });
  } catch (err) {
    // Clean up the uploaded file if DB insert fails
    await supabaseAdmin.storage.from('customer-files').remove([storagePath]);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
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

  try {
    const sql = getDb();
    const [row] = await sql`
      UPDATE customer_files SET
        file_status = CASE WHEN ${!!file_status} THEN ${file_status ?? null}::customer_file_status ELSE file_status END,
        file_type   = CASE WHEN ${!!file_type}   THEN ${file_type   ?? null}::customer_file_type   ELSE file_type   END
      WHERE id = ${fileId} AND customer_id = ${customerId} AND venue_id = ${venueId}
      RETURNING *
    `;
    return NextResponse.json(row);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
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

  try {
    const sql = getDb();
    const [fileRow] = await sql`
      SELECT storage_path FROM customer_files
      WHERE id = ${fileId} AND customer_id = ${customerId} AND venue_id = ${venueId}
    `;
    if (fileRow?.storage_path) {
      await supabaseAdmin.storage.from('customer-files').remove([fileRow.storage_path]);
    }
    await sql`
      DELETE FROM customer_files
      WHERE id = ${fileId} AND customer_id = ${customerId} AND venue_id = ${venueId}
    `;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
