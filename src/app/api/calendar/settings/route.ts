import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('venue_calendar_settings')
    .select('*')
    .eq('venue_id', venueId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!data) {
    // Auto-create defaults on first fetch
    const { data: created, error: createErr } = await supabaseAdmin
      .from('venue_calendar_settings')
      .insert({ venue_id: venueId })
      .select()
      .single();
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });
    return NextResponse.json(created);
  }

  // Don't expose raw tokens to client
  const safe = { ...data, google_access_token: undefined, google_refresh_token: undefined };
  return NextResponse.json(safe);
}

export async function PUT(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();

  // Strip fields that shouldn't be updated directly by client
  const { google_access_token, google_refresh_token, google_token_expiry, ...safe } = body;
  void google_access_token; void google_refresh_token; void google_token_expiry;

  const { data, error } = await supabaseAdmin
    .from('venue_calendar_settings')
    .upsert({ venue_id: venueId, ...safe, updated_at: new Date().toISOString() }, { onConflict: 'venue_id' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result = { ...data, google_access_token: undefined, google_refresh_token: undefined };
  return NextResponse.json(result);
}
