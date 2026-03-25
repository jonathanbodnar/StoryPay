import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { lpFetch } from '@/lib/lunarpay';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

  try {
    const customerResult = await lpFetch(`/api/v1/customers/${id}`, {
      method: 'GET',
      key: venue.lunarpay_secret_key,
    });

    const customer = customerResult.data || customerResult;

    const { data: proposals } = await supabaseAdmin
      .from('proposals')
      .select('id, customer_name, customer_email, status, price, payment_type, public_token, sent_at, signed_at, paid_at, created_at')
      .eq('venue_id', venueId)
      .or(`customer_email.eq.${customer.email}`);

    return NextResponse.json({
      customer: {
        id: customer.id,
        name: customer.name || [customer.firstName, customer.lastName].filter(Boolean).join(' '),
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        city: customer.city,
        state: customer.state,
        zip: customer.zip,
      },
      proposals: proposals || [],
    });
  } catch (err) {
    console.error('Customer detail error:', err);
    return NextResponse.json({ error: 'Failed to fetch customer' }, { status: 500 });
  }
}
