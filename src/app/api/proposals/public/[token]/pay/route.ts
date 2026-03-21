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

  const customerId = proposal.customer_lunarpay_id;
  if (!customerId) {
    return NextResponse.json({ error: 'Customer not linked to payment system' }, { status: 400 });
  }

  try {
    const pmResult = await savePaymentMethod(
      venue.lunarpay_secret_key,
      customerId,
      ticketId,
      nameHolder || proposal.customer_name
    );
    const pm = pmResult.data || pmResult;
    const paymentMethodId = pm.id;
    const updateData: Record<string, unknown> = {
      status: 'paid',
      paid_at: new Date().toISOString(),
      payment_method_id: paymentMethodId,
    };

    if (proposal.payment_type === 'full') {
      const chargeResult = await createCharge(venue.lunarpay_secret_key, {
        customerId,
        paymentMethodId,
        amount: proposal.price,
        description: `Proposal payment – ${proposal.customer_name}`,
      });
      const charge = chargeResult.data || chargeResult;
      updateData.charge_id = charge.id;
    } else if (proposal.payment_type === 'installment') {
      const config = proposal.payment_config as {
        installments: Array<{ amount: number; date: string }>;
      };
      const scheduleResult = await createPaymentSchedule(venue.lunarpay_secret_key, {
        customerId,
        paymentMethodId,
        description: `Installment plan – ${proposal.customer_name}`,
        payments: (config.installments || []).map((p) => ({
          amount: p.amount,
          date: p.date,
        })),
      });
      const schedule = scheduleResult.data || scheduleResult;
      updateData.payment_schedule_id = schedule.id;
    } else if (proposal.payment_type === 'subscription') {
      const config = proposal.payment_config as {
        amount: number;
        frequency: string;
        start_date: string;
      };
      const subResult = await createSubscription(venue.lunarpay_secret_key, {
        customerId,
        paymentMethodId,
        amount: config.amount,
        frequency: config.frequency,
        startOn: config.start_date,
        description: `Subscription – ${proposal.customer_name}`,
      });
      const sub = subResult.data || subResult;
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
    const msg = err instanceof Error ? err.message : 'Payment failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
