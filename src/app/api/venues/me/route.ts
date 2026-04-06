import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function getVenueId() {
  const cookieStore = await cookies();
  return cookieStore.get('venue_id')?.value;
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: venue, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, email, phone, address, city, state, zip, onboarding_status, onboarding_mpa_url, ghl_connected, setup_completed, lunarpay_merchant_id, pass_service_fee, brand_logo_url, brand_tagline, brand_website, brand_color, brand_email, brand_phone, brand_address, brand_city, brand_state, brand_zip, brand_footer_note')
    .eq('id', venueId)
    .single();

  if (error || !venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  return NextResponse.json(venue);
}

export async function PATCH(request: Request) {
  const venueId = await getVenueId();
  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const allowedFields: Record<string, boolean> = {
    pass_service_fee: true,
    brand_logo_url: true,
    brand_tagline: true,
    brand_website: true,
    brand_color: true,
    brand_email: true,
    brand_phone: true,
    brand_address: true,
    brand_city: true,
    brand_state: true,
    brand_zip: true,
    brand_footer_note: true,
  };
  const updates: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (allowedFields[key]) {
      updates[key] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data: venue, error } = await supabaseAdmin
    .from('venues')
    .update(updates)
    .eq('id', venueId)
    .select('id, pass_service_fee, brand_logo_url, brand_tagline, brand_website, brand_color, brand_email, brand_phone, brand_address, brand_city, brand_state, brand_zip, brand_footer_note')
    .single();

  if (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }

  return NextResponse.json(venue);
}
