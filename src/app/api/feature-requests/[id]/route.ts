import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

async function isAdmin() {
  const c = await cookies();
  const token = c.get('admin_token')?.value;
  return !!token && token === process.env.ADMIN_SECRET;
}

// PATCH — venue can edit their own title/description
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const venueId = await getVenueId();
  const admin = await isAdmin();

  if (!venueId && !admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { title, description } = await req.json();
  if (!title?.trim()) return NextResponse.json({ error: 'Title required' }, { status: 400 });

  const query = supabaseAdmin
    .from('feature_requests')
    .update({ title: title.trim(), description: description?.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', id);

  // Venues can only edit their own
  if (!admin && venueId) query.eq('venue_id', venueId);

  const { data, error } = await query.select('id, title, description').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE — venue can delete their own; admin can delete any
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const venueId = await getVenueId();
  const admin = await isAdmin();

  if (!venueId && !admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Build delete query — admin deletes any, venue deletes only their own
  const query = supabaseAdmin.from('feature_requests').delete().eq('id', id);
  if (!admin && venueId) {
    query.eq('venue_id', venueId);
  }

  const { error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
