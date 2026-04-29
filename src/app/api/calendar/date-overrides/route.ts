import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('venue_date_overrides')
    .select('*')
    .eq('venue_id', venueId)
    .gte('override_date', new Date().toISOString().split('T')[0])
    .order('override_date');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { override_date, is_available, start_time, end_time, label } = body;

  if (!override_date) {
    return NextResponse.json({ error: 'override_date is required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('venue_date_overrides')
    .upsert(
      { venue_id: venueId, override_date, is_available: is_available ?? false, start_time, end_time, label },
      { onConflict: 'venue_id,override_date' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('venue_date_overrides')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
