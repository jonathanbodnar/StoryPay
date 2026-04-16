import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const search = searchParams.get('search') ?? '';

  let q = supabaseAdmin
    .from('venue_customers')
    .select('*, venue_spaces(id, name, color)')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });

  if (search) {
    q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,customer_email.ilike.%${search}%`);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { customer_email, first_name, last_name, phone, ghl_contact_id, lunarpay_customer_id, external_id } = body;

  // Use provided email, or fall back to a stable placeholder keyed by external_id or name
  // so customers without an email address can still have a CRM profile.
  const email = customer_email
    ? customer_email.toLowerCase()
    : `no-email-${(external_id || `${first_name || ''}-${last_name || ''}`).toLowerCase().replace(/[^a-z0-9]/g, '-')}@storypay.internal`;

  const { data, error } = await supabaseAdmin
    .from('venue_customers')
    .upsert(
      {
        venue_id: venueId,
        customer_email: email,
        first_name: first_name || '',
        last_name: last_name || '',
        phone: phone || null,
        ghl_contact_id: ghl_contact_id || null,
        lunarpay_customer_id: lunarpay_customer_id || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'venue_id,customer_email', ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
