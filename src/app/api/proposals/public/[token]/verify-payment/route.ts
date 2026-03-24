import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCheckoutSession, createPaymentSchedule, createSubscription } from '@/lib/lunarpay';

interface Installment {
  amount: number;
  date: string;
}

interface InstallmentConfig {
  installments: Installment[];
}

interface SubscriptionConfig {
  amount: number;
  frequency: string;
  start_date: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { session_id } = await request.json();

  if (!session_id) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  }

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('id, venue_id, status, payment_type, payment_config, customer_name, customer_lunarpay_id')
    .eq('public_token', token)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  if (proposal.status === 'paid') {
    return NextResponse.json({ success: true, already_paid: true });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key')
    .eq('id', proposal.venue_id)
    .single();

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'Venue payment not configured' }, { status: 400 });
  }

  try {
    const result = await getCheckoutSession(venue.lunarpay_secret_key, session_id);
    const session = result.data || result;

    if (session.status !== 'completed') {
      return NextResponse.json(
        { error: 'Payment not completed', status: session.status },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {
      status: 'paid',
      paid_at: session.paid_at || new Date().toISOString(),
      checkout_session_id: session_id,
      transaction_id: session.transaction_id || null,
    };

    // For installment plans, schedule the remaining payments via LunarPay
    if (proposal.payment_type === 'installment' && proposal.payment_config) {
      const config = proposal.payment_config as InstallmentConfig;
      const remaining = (config.installments || []).slice(1);

      if (remaining.length > 0 && session.customer_id) {
        try {
          const scheduleResult = await createPaymentSchedule(venue.lunarpay_secret_key, {
            customerId: session.customer_id,
            paymentMethodId: session.payment_method_id,
            description: `${proposal.customer_name} - Installment plan`,
            payments: remaining.map((p) => ({
              amount: p.amount,
              date: p.date,
            })),
          });
          const schedule = scheduleResult.data || scheduleResult;
          updateData.payment_schedule_id = schedule.id;
          console.log('Payment schedule created:', schedule.id);
        } catch (scheduleErr) {
          console.error('Failed to create payment schedule (first payment still succeeded):', scheduleErr);
        }
      }
    }

    // For subscriptions, create the recurring subscription via LunarPay
    if (proposal.payment_type === 'subscription' && proposal.payment_config) {
      const config = proposal.payment_config as SubscriptionConfig;

      if (session.customer_id && session.payment_method_id) {
        try {
          const subResult = await createSubscription(venue.lunarpay_secret_key, {
            customerId: session.customer_id,
            paymentMethodId: session.payment_method_id,
            amount: config.amount,
            frequency: config.frequency,
            startOn: config.start_date,
            description: `${proposal.customer_name} - ${config.frequency} subscription`,
          });
          const sub = subResult.data || subResult;
          updateData.subscription_id = sub.id;
          console.log('Subscription created:', sub.id);
        } catch (subErr) {
          console.error('Failed to create subscription (first payment still succeeded):', subErr);
        }
      }
    }

    await supabaseAdmin
      .from('proposals')
      .update(updateData)
      .eq('id', proposal.id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Verify payment error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to verify payment' },
      { status: 500 }
    );
  }
}
