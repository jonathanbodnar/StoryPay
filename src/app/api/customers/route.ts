import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { listCustomers, createCustomer } from '@/lib/lunarpay';

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key')
    .eq('id', venueId)
    .single();

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'LunarPay not configured' }, { status: 400 });
  }

  const search = request.nextUrl.searchParams.get('search') || '';
  const page = parseInt(request.nextUrl.searchParams.get('page') || '1', 10);
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50', 10);

  try {
    const result = await listCustomers(venue.lunarpay_secret_key, search, page, limit);
    return NextResponse.json(result);
  } catch (err) {
    console.error('Customer list error:', err);
    return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key')
    .eq('id', venueId)
    .single();

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'LunarPay not configured' }, { status: 400 });
  }

  const body = await request.json();
  const { firstName, lastName, email, phone, address, city, state, zip } = body;

  if (!firstName || !lastName || !email) {
    return NextResponse.json(
      { error: 'firstName, lastName, and email are required' },
      { status: 400 }
    );
  }

  try {
    const customer = await createCustomer(venue.lunarpay_secret_key, {
      name: `${firstName} ${lastName}`,
      email,
      phone: phone || undefined,
      address: address || undefined,
      city: city || undefined,
      state: state || undefined,
      zip: zip || undefined,
    });

    return NextResponse.json(customer, { status: 201 });
  } catch (err) {
    console.error('Customer creation error:', err);
    return NextResponse.json({ error: 'Failed to create customer' }, { status: 500 });
  }
}
