import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function verifyAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return token && token === process.env.ADMIN_SECRET;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const { data: req } = await supabaseAdmin
    .from('feature_requests')
    .select('id, title, description, vote_count, status, created_at')
    .eq('id', id)
    .single();

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: votes } = await supabaseAdmin
    .from('feature_request_votes')
    .select('venue_id, created_at')
    .eq('request_id', id)
    .order('created_at', { ascending: false });

  const venueIds = (votes ?? []).map(v => v.venue_id);
  let venueMap: Record<string, string> = {};
  if (venueIds.length > 0) {
    const { data: venues } = await supabaseAdmin
      .from('venues')
      .select('id, name')
      .in('id', venueIds);
    venueMap = Object.fromEntries((venues ?? []).map(v => [v.id, v.name]));
  }

  const voters = (votes ?? []).map(v => ({
    venue_id: v.venue_id,
    venue_name: venueMap[v.venue_id] || 'Unknown Venue',
    voted_at: v.created_at,
  }));

  return NextResponse.json({ ...req, voters });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { status } = await request.json();
  const valid = ['open', 'planned', 'in_progress', 'completed'];
  if (!valid.includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('feature_requests')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, status')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { error } = await supabaseAdmin.from('feature_requests').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
