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
    .select('*')
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
    monthly_booking_goal: true,
    listing_marketing_monthly_spend: true,
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

  let { data: venue, error } = await supabaseAdmin
    .from('venues')
    .update(updates)
    .eq('id', venueId)
    .select('*')
    .single();

  // If a column doesn't exist in this DB (schema mismatch), strip unknown fields and retry
  if (error && error.message?.includes('column')) {
    console.error('[venues/me] PATCH error (will retry without unknown columns):', error.message);
    const safeUpdates: Record<string, unknown> = {};
    const knownCols = ['name', 'service_fee_rate', 'brand_logo_url', 'brand_color',
      'brand_tagline', 'brand_website', 'brand_email', 'brand_phone',
      'brand_address', 'brand_city', 'brand_state', 'brand_zip', 'brand_footer_note', 'monthly_booking_goal',
      'listing_marketing_monthly_spend'];
    for (const k of knownCols) {
      if (k in updates) safeUpdates[k] = updates[k];
    }
    if (Object.keys(safeUpdates).length > 0) {
      const retry = await supabaseAdmin.from('venues').update(safeUpdates).eq('id', venueId).select('*').single();
      venue = retry.data;
      error = retry.error;
    }
  }

  if (error) {
    console.error('[venues/me] PATCH failed:', error.message);
    return NextResponse.json({ error: 'Failed to update', detail: error.message }, { status: 500 });
  }

  return NextResponse.json(venue);
}
