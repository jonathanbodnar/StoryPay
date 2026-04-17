import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId, getMemberName } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from('customer_notes')
    .select('*')
    .eq('customer_id', id)
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[customer-notes GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const { content } = await request.json();
  if (!content?.trim()) return NextResponse.json({ error: 'Content is required' }, { status: 400 });

  const authorName = await getMemberName();
  const trimmed = content.trim();

  const { data: row, error } = await supabaseAdmin
    .from('customer_notes')
    .insert({
      customer_id: id,
      venue_id: venueId,
      content: trimmed,
      author_name: authorName,
    })
    .select('*')
    .single();

  if (error || !row) {
    console.error('[customer-notes POST]', error);
    return NextResponse.json({ error: error?.message ?? 'Failed to save note' }, { status: 500 });
  }

  // Best-effort activity log; failure shouldn't block the note creation response.
  await supabaseAdmin.from('customer_activity').insert({
    venue_id: venueId,
    customer_id: id,
    activity_type: 'note_added',
    title: 'Note added',
    description: trimmed.slice(0, 120),
  });

  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: customerId } = await params;

  const { noteId, content } = await request.json();
  if (!noteId) return NextResponse.json({ error: 'noteId required' }, { status: 400 });
  if (!content?.trim()) return NextResponse.json({ error: 'Content is required' }, { status: 400 });

  const { data: row, error } = await supabaseAdmin
    .from('customer_notes')
    .update({ content: content.trim() })
    .eq('id', noteId)
    .eq('customer_id', customerId)
    .eq('venue_id', venueId)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[customer-notes PATCH]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: customerId } = await params;
  const noteId = request.nextUrl.searchParams.get('noteId');
  if (!noteId) return NextResponse.json({ error: 'noteId required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('customer_notes')
    .delete()
    .eq('id', noteId)
    .eq('customer_id', customerId)
    .eq('venue_id', venueId);

  if (error) {
    console.error('[customer-notes DELETE]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
