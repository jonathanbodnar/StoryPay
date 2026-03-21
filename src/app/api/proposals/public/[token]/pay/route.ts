import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  savePaymentMethod,
  createCharge,
  createPaymentSchedule,
  createSubscription,
} from '@/lib/lunarpay';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { ticketId, nameHolder } = await request.json();

  if (!ticketId) {
    return NextResponse.json({ error: 'Payment token required' }, { status: 400 });
  }

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('*')
    .eq('public_token', token)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  if (proposal.status !== 'signed') {
    return NextResponse.json({ error: 'Proposal must be signed before payment' }, { status: 400 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key')
    .eq('id', proposal.venue_id)
    .single();

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'Venue payment not configured' }, { status: 500 });
  }

  try {
    const pm = await savePaymentMethod(
      venue.lunarpay_secret_key,
      proposal.lunarpay_customer_id,
      ticketId,
      nameHolder || proposal.customer_name
    );

    const paymentMethodId = pm.id;
    const updateData: Record<string, unknown> = {
      status: 'paid',
      paid_at: new Date().toISOString(),
      payment_method_id: paymentMethodId,
    };

    if (proposal.payment_type === 'full') {
      const charge = await createCharge(venue.lunarpay_secret_key, {
        customerId: proposal.lunarpay_customer_id,
        paymentMethodId,
        amount: proposal.price,
        description: `Proposal payment – ${proposal.customer_name}`,
      });
      updateData.charge_id = charge.id;
    } else if (proposal.payment_type === 'installment') {
      const config = proposal.payment_config as { payments: Array<{ amount: number; date: string }> };
      const schedule = await createPaymentSchedule(venue.lunarpay_secret_key, {
        customerId: proposal.lunarpay_customer_id,
        paymentMethodId,
        description: `Installment plan – ${proposal.customer_name}`,
        payments: config.payments.map((p: { amount: number; date: string }) => ({
          amount: p.amount,
          scheduledDate: p.date,
        })),
      });
      updateData.payment_schedule_id = schedule.id;
    } else if (proposal.payment_type === 'subscription') {
      const config = proposal.payment_config as {
        amount: number;
        interval: string;
        intervalCount: number;
        startDate: string;
      };
      const sub = await createSubscription(venue.lunarpay_secret_key, {
        customerId: proposal.lunarpay_customer_id,
        paymentMethodId,
        amount: config.amount,
        interval: config.interval,
        intervalCount: config.intervalCount,
        startDate: config.startDate,
        description: `Subscription – ${proposal.customer_name}`,
      });
      updateData.subscription_id = sub.id;
    }

    await supabaseAdmin
      .from('proposals')
      .update(updateData)
      .eq('id', proposal.id);

    return NextResponse.json({
      success: true,
      invoiceUrl: `/invoice/${proposal.id}`,
    });
  } catch (err) {
    console.error('Payment error:', err);
    return NextResponse.json({ error: 'Payment failed' }, { status: 500 });
  }
}
