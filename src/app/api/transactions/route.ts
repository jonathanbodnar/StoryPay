import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { listPaymentSchedules, getSubscription } from '@/lib/lunarpay';

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const type = request.nextUrl.searchParams.get('type') || 'charges';

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key')
    .eq('id', venueId)
    .single();

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'LunarPay not configured' }, { status: 400 });
  }

  try {
    if (type === 'charges') {
      const { data: proposals } = await supabaseAdmin
        .from('proposals')
        .select('id, customer_name, price, status, charge_id, created_at')
        .eq('venue_id', venueId)
        .not('charge_id', 'is', null)
        .order('created_at', { ascending: false });

      return NextResponse.json(
        (proposals ?? []).map((p) => ({
          id: p.id,
          description: `Proposal — ${p.customer_name}`,
          amount: p.price,
          status: p.status,
          date: p.created_at,
          chargeId: p.charge_id,
        }))
      );
    }

    if (type === 'schedules') {
      const schedules = await listPaymentSchedules(venue.lunarpay_secret_key);
      const items = Array.isArray(schedules) ? schedules : schedules.data ?? [];
      return NextResponse.json(items);
    }

    if (type === 'subscriptions') {
      const { data: proposals } = await supabaseAdmin
        .from('proposals')
        .select('id, customer_name, price, status, subscription_id, payment_config, created_at')
        .eq('venue_id', venueId)
        .not('subscription_id', 'is', null)
        .order('created_at', { ascending: false });

      const subscriptions = await Promise.all(
        (proposals ?? []).map(async (p) => {
          try {
            const sub = await getSubscription(venue.lunarpay_secret_key, p.subscription_id);
            return {
              id: p.id,
              description: `Proposal — ${p.customer_name}`,
              amount: sub.amount ?? p.price,
              frequency: sub.frequency ?? p.payment_config?.frequency ?? 'monthly',
              status: sub.status ?? p.status,
              nextPayment: sub.nextPaymentDate ?? null,
              subscriptionId: p.subscription_id,
            };
          } catch {
            return {
              id: p.id,
              description: `Proposal — ${p.customer_name}`,
              amount: p.price,
              frequency: p.payment_config?.frequency ?? 'monthly',
              status: p.status,
              nextPayment: null,
              subscriptionId: p.subscription_id,
            };
          }
        })
      );

      return NextResponse.json(subscriptions);
    }

    return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 });
  } catch (err) {
    console.error('Transactions fetch error:', err);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}
