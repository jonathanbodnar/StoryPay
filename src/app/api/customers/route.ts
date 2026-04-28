import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createCustomer } from '@/lib/lunarpay';
import { mergeVenueContacts } from '@/lib/merge-venue-contacts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, lunarpay_secret_key, ghl_connected, ghl_location_id')
    .eq('id', venueId)
    .single();

  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  const search = request.nextUrl.searchParams.get('search') || '';
  const page = parseInt(request.nextUrl.searchParams.get('page') || '1', 10);
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '100', 10);

  console.log(
    `[customers] venueId=${venueId} ghl_connected=${venue.ghl_connected} ghl_location=${venue.ghl_location_id} has_lp=${!!venue.lunarpay_secret_key}`,
  );

  const filtered = await mergeVenueContacts(venueId, { search, page, limit });
  return NextResponse.json(filtered);
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { firstName, lastName, email, phone, address, city, state, zip } = body;

  const firstNameTrimmed = String(firstName ?? '').trim();
  const lastNameTrimmed  = String(lastName  ?? '').trim();
  const emailTrimmed     = String(email     ?? '').trim();
  const phoneTrimmed     = String(phone     ?? '').trim();

  if (!firstNameTrimmed) return NextResponse.json({ error: 'First name is required' }, { status: 400 });
  if (!lastNameTrimmed)  return NextResponse.json({ error: 'Last name is required' }, { status: 400 });
  if (!emailTrimmed)     return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  if (!phoneTrimmed)     return NextResponse.json({ error: 'Phone is required' }, { status: 400 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key')
    .eq('id', venueId)
    .single();

  // Best-effort LunarPay sync (only when the venue has connected it).
  let lunarpayCustomerId: string | null = null;
  let lunarpayError: string | null = null;
  if (venue?.lunarpay_secret_key) {
    try {
      const lp = await createCustomer(venue.lunarpay_secret_key, {
        name: `${firstName} ${lastName}`,
        email,
        phone:   phone   || undefined,
        address: address || undefined,
        city:    city    || undefined,
        state:   state   || undefined,
        zip:     zip     || undefined,
      });
      lunarpayCustomerId = String((lp as { id?: string | number })?.id ?? '') || null;
    } catch (err) {
      lunarpayError = err instanceof Error ? err.message : 'LunarPay sync failed';
      console.error('[customers] LunarPay sync error:', err);
    }
  }

  // Always persist to StoryVenue's own venue_customers table. This is the source
  // of truth inside the dashboard — LunarPay / GHL are downstream sinks.
  const { data: row, error: dbErr } = await supabaseAdmin
    .from('venue_customers')
    .upsert(
      {
        venue_id:             venueId,
        customer_email:       email.toLowerCase(),
        first_name:           firstName,
        last_name:            lastName,
        phone:                phone || null,
        lunarpay_customer_id: lunarpayCustomerId,
        updated_at:           new Date().toISOString(),
      },
      { onConflict: 'venue_id,customer_email' },
    )
    .select('id, customer_email, first_name, last_name, phone, lunarpay_customer_id, ghl_contact_id')
    .single();

  if (dbErr || !row) {
    console.error('[customers] venue_customers upsert error:', dbErr);
    return NextResponse.json(
      { error: `Failed to save contact: ${dbErr?.message ?? 'unknown error'}` },
      { status: 500 },
    );
  }

  const customer = {
    id:        row.lunarpay_customer_id || row.ghl_contact_id || row.id,
    name:      [row.first_name, row.last_name].filter(Boolean).join(' ') || row.customer_email,
    firstName: row.first_name,
    lastName:  row.last_name,
    email:     row.customer_email,
    phone:     row.phone || '',
    source:    row.lunarpay_customer_id ? 'lunarpay' : 'storypay',
  };

  return NextResponse.json(
    { ...customer, warnings: lunarpayError ? [lunarpayError] : undefined },
    { status: 201 },
  );
}
