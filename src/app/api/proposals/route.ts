import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createCustomer } from '@/lib/lunarpay';
import { ghlRequest, sendSms } from '@/lib/ghl';
import { generateToken } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = request.nextUrl.searchParams.get('limit');

  let query = supabaseAdmin
    .from('proposals')
    .select('*')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });

  if (limit) {
    query = query.limit(parseInt(limit, 10));
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const {
    templateId, customerName, customerEmail, customerPhone, customerId,
    price, paymentType, paymentConfig,
  } = body;

  if (!templateId || !customerName || !customerEmail) {
    return NextResponse.json(
      { error: 'templateId, customerName, and customerEmail are required' },
      { status: 400 }
    );
  }

  if (!price || price <= 0) {
    return NextResponse.json({ error: 'A valid price is required' }, { status: 400 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key, ghl_connected, ghl_access_token, ghl_location_id, name')
    .eq('id', venueId)
    .single();

  const { data: template, error: templateError } = await supabaseAdmin
    .from('proposal_templates')
    .select('content')
    .eq('id', templateId)
    .eq('venue_id', venueId)
    .single();

  if (templateError || !template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const { data: sigFields } = await supabaseAdmin
    .from('proposal_template_fields')
    .select('*')
    .eq('template_id', templateId)
    .order('sort_order', { ascending: true });

  let customerLunarpayId = customerId || null;

  if (venue?.lunarpay_secret_key && !customerLunarpayId) {
    try {
      const nameParts = customerName.split(' ');
      const lpResult = await createCustomer(venue.lunarpay_secret_key, {
        firstName: nameParts[0] || customerName,
        lastName: nameParts.slice(1).join(' ') || '',
        email: customerEmail,
        phone: customerPhone || undefined,
      });
      const lpCustomer = lpResult.data || lpResult;
      customerLunarpayId = lpCustomer.id;
    } catch (err) {
      console.error('LunarPay customer creation failed:', err);
    }
  }

  const publicToken = generateToken();

  const { data: proposal, error: insertError } = await supabaseAdmin
    .from('proposals')
    .insert({
      venue_id: venueId,
      template_id: templateId,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone || null,
      customer_lunarpay_id: customerLunarpayId,
      content: template.content,
      price,
      payment_type: paymentType || 'full',
      payment_config: paymentConfig || {},
      signature_fields: sigFields ?? [],
      public_token: publicToken,
      status: 'sent',
      sent_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  if (
    venue?.ghl_connected &&
    venue.ghl_access_token &&
    venue.ghl_location_id &&
    customerPhone
  ) {
    try {
      const searchRes = await ghlRequest(
        `/contacts/search/duplicate?locationId=${venue.ghl_location_id}&phone=${encodeURIComponent(customerPhone)}`,
        venue.ghl_access_token,
        { locationId: venue.ghl_location_id }
      );

      let contactId = searchRes.contact?.id;

      if (!contactId) {
        const createRes = await ghlRequest('/contacts/', venue.ghl_access_token, {
          method: 'POST',
          body: {
            locationId: venue.ghl_location_id,
            firstName: customerName.split(' ')[0],
            lastName: customerName.split(' ').slice(1).join(' ') || '',
            email: customerEmail,
            phone: customerPhone,
          },
          locationId: venue.ghl_location_id,
        });
        contactId = createRes.contact?.id;
      }

      if (contactId) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
        const proposalUrl = `${appUrl}/proposal/${publicToken}`;
        const message = `Hi ${customerName}, ${venue.name} has sent you a proposal. View and sign here: ${proposalUrl}`;
        await sendSms(venue.ghl_access_token, venue.ghl_location_id, contactId, message);
      }
    } catch (err) {
      console.error('GHL SMS send failed:', err);
    }
  }

  return NextResponse.json(proposal, { status: 201 });
}
