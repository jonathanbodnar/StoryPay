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

  if (admin) {
    const { error } = await supabaseAdmin.rpc('admin_delete_feature_request', { p_id: id });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabaseAdmin.rpc('venue_delete_feature_request', {
    p_id: id,
    p_venue_id: venueId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
