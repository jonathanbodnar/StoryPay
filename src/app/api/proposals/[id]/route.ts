import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createCustomer } from '@/lib/lunarpay';
import { ghlRequest, sendSms } from '@/lib/ghl';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('*')
    .eq('id', id)
    .eq('venue_id', venueId)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  return NextResponse.json(proposal);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('proposals')
    .select('*')
    .eq('id', id)
    .eq('venue_id', venueId)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  const {
    customerName, customerEmail, customerPhone,
    price, paymentType, paymentConfig,
    sendNow,
  } = body;

  if (sendNow && existing.status !== 'draft') {
    return NextResponse.json(
      { error: 'Only drafts can be sent' },
      { status: 409 }
    );
  }

  const updateData: Record<string, unknown> = {};

  if (customerName !== undefined) updateData.customer_name = customerName;
  if (customerEmail !== undefined) updateData.customer_email = customerEmail;
  if (customerPhone !== undefined) updateData.customer_phone = customerPhone || null;
  if (price !== undefined) updateData.price = price;
  if (paymentType !== undefined) updateData.payment_type = paymentType;
  if (paymentConfig !== undefined) updateData.payment_config = paymentConfig;

  if (sendNow) {
    const name = customerName || existing.customer_name;
    const email = customerEmail || existing.customer_email;
    const phone = customerPhone ?? existing.customer_phone;
    const finalPrice = price ?? existing.price;

    if (!name || !email) {
      return NextResponse.json(
        { error: 'Customer name and email are required to send' },
        { status: 400 }
      );
    }
    if (!finalPrice || finalPrice <= 0) {
      return NextResponse.json({ error: 'A valid price is required to send' }, { status: 400 });
    }

    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('lunarpay_secret_key, ghl_connected, ghl_access_token, ghl_location_id, name')
      .eq('id', venueId)
      .single();

    if (venue?.lunarpay_secret_key && !existing.customer_lunarpay_id) {
      try {
        const nameParts = name.split(' ');
        const lpResult = await createCustomer(venue.lunarpay_secret_key, {
          firstName: nameParts[0] || name,
          lastName: nameParts.slice(1).join(' ') || '',
          email,
          phone: phone || undefined,
        });
        const lpCustomer = lpResult.data || lpResult;
        updateData.customer_lunarpay_id = lpCustomer.id;
      } catch (err) {
        console.error('LunarPay customer creation failed:', err);
      }
    }

    updateData.status = 'sent';
    updateData.sent_at = new Date().toISOString();
    updateData.customer_name = name;
    updateData.customer_email = email;
    updateData.customer_phone = phone || null;

    if (
      venue?.ghl_connected &&
      venue.ghl_access_token &&
      venue.ghl_location_id &&
      phone
    ) {
      try {
        const searchRes = await ghlRequest(
          `/contacts/search/duplicate?locationId=${venue.ghl_location_id}&phone=${encodeURIComponent(phone)}`,
          venue.ghl_access_token,
          { locationId: venue.ghl_location_id }
        );

        let contactId = searchRes.contact?.id;

        if (!contactId) {
          const createRes = await ghlRequest('/contacts/', venue.ghl_access_token, {
            method: 'POST',
            body: {
              locationId: venue.ghl_location_id,
              firstName: name.split(' ')[0],
              lastName: name.split(' ').slice(1).join(' ') || '',
              email,
              phone,
            },
            locationId: venue.ghl_location_id,
          });
          contactId = createRes.contact?.id;
        }

        if (contactId) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
          const proposalUrl = `${appUrl}/proposal/${existing.public_token}`;
          const message = `Hi ${name}, ${venue.name} has sent you a proposal. View and sign here: ${proposalUrl}`;
          await sendSms(venue.ghl_access_token, venue.ghl_location_id, contactId, message);
        }
      } catch (err) {
        console.error('GHL SMS send failed:', err);
      }
    }
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('proposals')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const { data: existing } = await supabaseAdmin
    .from('proposals')
    .select('status')
    .eq('id', id)
    .eq('venue_id', venueId)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  if (existing.status !== 'draft') {
    return NextResponse.json({ error: 'Only drafts can be deleted' }, { status: 409 });
  }

  const { error } = await supabaseAdmin
    .from('proposals')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
