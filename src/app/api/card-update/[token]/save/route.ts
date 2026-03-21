import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { savePaymentMethod } from '@/lib/lunarpay';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { ticketId, nameHolder } = await request.json();

  if (!ticketId) {
    return NextResponse.json({ error: 'Payment token required' }, { status: 400 });
  }

  const { data: cardToken, error } = await supabaseAdmin
    .from('card_update_tokens')
    .select('*')
    .eq('token', token)
    .single();

  if (error || !cardToken) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
  }

  if (cardToken.used) {
    return NextResponse.json({ error: 'Token already used' }, { status: 400 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key')
    .eq('id', cardToken.venue_id)
    .single();

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'Venue not configured' }, { status: 500 });
  }

  try {
    await savePaymentMethod(
      venue.lunarpay_secret_key,
      cardToken.lunarpay_customer_id,
      ticketId,
      nameHolder || cardToken.customer_name
    );

    await supabaseAdmin
      .from('card_update_tokens')
      .update({ used: true, used_at: new Date().toISOString() })
      .eq('id', cardToken.id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Card update error:', err);
    return NextResponse.json({ error: 'Failed to update card' }, { status: 500 });
  }
}
