import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from('venue_customers')
    .select('*, venue_spaces(id, name, color)')
    .eq('id', id)
    .eq('venue_id', venueId)
    .single();

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const body = await request.json();
  const allowed = [
    'first_name','last_name','phone',
    'partner_first_name','partner_last_name','partner_email','partner_phone',
    'wedding_date','wedding_space_id','ceremony_type','guest_count',
    'rehearsal_date','coordinator_name','coordinator_phone','catering_notes',
    'referral_source','pipeline_stage','tags',
  ];

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  const { data, error } = await supabaseAdmin
    .from('venue_customers')
    .update(update)
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('*, venue_spaces(id, name, color)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
