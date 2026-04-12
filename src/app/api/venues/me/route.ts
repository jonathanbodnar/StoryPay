import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Never cache this route — it returns live per-venue data
export const dynamic = 'force-dynamic';

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
    .select('id, name, email, phone, address, city, state, zip, onboarding_status, onboarding_mpa_url, ghl_connected, ghl_location_id, setup_completed, lunarpay_merchant_id, service_fee_rate, brand_logo_url, brand_tagline, brand_website, brand_color, brand_bg_color, brand_btn_text, brand_email, brand_phone, brand_address, brand_city, brand_state, brand_zip, brand_footer_note')
    .eq('id', venueId)
    .single();

  if (error || !venue) {
    console.error('[venues/me] query error:', error?.message, 'venueId:', venueId);
    return NextResponse.json({ error: 'Venue not found', detail: error?.message }, { status: 404 });
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
    name:              true,
    service_fee_rate:  true,
    brand_logo_url:    true,
    brand_color:       true,  // primary / button color
    brand_bg_color:    true,  // background color
    brand_btn_text:    true,  // button text color
    brand_tagline:     true,
    brand_website:     true,
    brand_email:       true,
    brand_phone:       true,
    brand_address:     true,
    brand_city:        true,
    brand_state:       true,
    brand_zip:         true,
    brand_footer_note: true,
  };
  const updates: Record<string, unknown> = {};

  // Use Object.keys on the raw body so null values are explicitly included.
  // This is important for clearing fields like brand_logo_url — Supabase's
  // .update() needs the key present with a null value to write NULL to the DB.
  for (const key of Object.keys(body)) {
    if (allowedFields[key]) {
      updates[key] = body[key] ?? null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data: venue, error } = await supabaseAdmin
    .from('venues')
    .update(updates)
    .eq('id', venueId)
    .select('id, name, service_fee_rate, brand_logo_url, brand_color, brand_bg_color, brand_btn_text, brand_tagline, brand_website, brand_email, brand_phone, brand_address, brand_city, brand_state, brand_zip, brand_footer_note')
    .single();

  if (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }

  return NextResponse.json(venue);
}
