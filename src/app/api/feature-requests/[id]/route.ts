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
