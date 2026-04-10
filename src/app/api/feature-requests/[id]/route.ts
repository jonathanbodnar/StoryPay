import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

async function isAdmin() {
  const c = await cookies();
  return !!c.get('admin_token')?.value;
}

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

  // Admins can delete any request; venues can only delete their own
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
