import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { listPaymentSchedules, getSubscription, listCustomers } from '@/lib/lunarpay';

export const dynamic = 'force-dynamic';

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
        .select('id, customer_name, customer_email, customer_lunarpay_id, price, status, charge_id, checkout_session_id, transaction_id, paid_at, created_at')
        .eq('venue_id', venueId)
        .eq('status', 'paid')
        .order('paid_at', { ascending: false });

      // For proposals missing a LunarPay customer ID, look it up by email and backfill
      const resolved = await Promise.all(
        (proposals ?? []).map(async (p) => {
          let customerId = p.customer_lunarpay_id ?? null;

          if (!customerId && p.customer_email) {
            try {
              const result = await listCustomers(venue.lunarpay_secret_key, p.customer_email, 1, 1);
              const items = Array.isArray(result) ? result : result.data ?? [];
              if (items.length > 0) {
                customerId = items[0].id;
                // Backfill so future lookups are instant
                await supabaseAdmin
                  .from('proposals')
                  .update({ customer_lunarpay_id: customerId })
                  .eq('id', p.id);
              }
            } catch {
              // best-effort
            }
          }

          return {
            id: p.id,
            description: `Proposal - ${p.customer_name}`,
            amount: p.price,
            status: p.status,
            date: p.paid_at || p.created_at,
            chargeId: p.charge_id,
            transactionId: p.transaction_id,
            sessionId: p.checkout_session_id,
            customerId,
            customerName: p.customer_name,
          };
        })
      );

      return NextResponse.json(resolved);
    }

    if (type === 'schedules') {
      const { data: proposals } = await supabaseAdmin
        .from('proposals')
        .select('id, customer_name, customer_email, customer_lunarpay_id, schedule_id')
        .eq('venue_id', venueId)
        .not('schedule_id', 'is', null);

      const customerMap: Record<string, { customerId: string | null; customerName: string | null }> = {};
      for (const p of proposals ?? []) {
        if (!p.schedule_id) continue;
        let customerId = p.customer_lunarpay_id ?? null;
        if (!customerId && p.customer_email) {
          try {
            const result = await listCustomers(venue.lunarpay_secret_key, p.customer_email, 1, 1);
            const items = Array.isArray(result) ? result : result.data ?? [];
            if (items.length > 0) {
              customerId = items[0].id;
              await supabaseAdmin.from('proposals').update({ customer_lunarpay_id: customerId }).eq('id', p.id);
            }
          } catch { /* best-effort */ }
        }
        customerMap[String(p.schedule_id)] = {
          customerId,
          customerName: p.customer_name ?? null,
        };
      }

      const schedules = await listPaymentSchedules(venue.lunarpay_secret_key);
      const items = (Array.isArray(schedules) ? schedules : schedules.data ?? []).map(
        (s: Record<string, unknown>) => ({
          ...s,
          customerId: customerMap[String(s.id)]?.customerId ?? null,
          customerName: customerMap[String(s.id)]?.customerName ?? null,
        })
      );
      return NextResponse.json(items);
    }

    if (type === 'subscriptions') {
      const { data: proposals } = await supabaseAdmin
        .from('proposals')
        .select('id, customer_name, customer_email, customer_lunarpay_id, price, status, subscription_id, payment_config, created_at')
        .eq('venue_id', venueId)
        .not('subscription_id', 'is', null)
        .order('created_at', { ascending: false });

      const subscriptions = await Promise.all(
        (proposals ?? []).map(async (p) => {
          let customerId = p.customer_lunarpay_id ?? null;
          if (!customerId && p.customer_email) {
            try {
              const result = await listCustomers(venue.lunarpay_secret_key, p.customer_email, 1, 1);
              const items = Array.isArray(result) ? result : result.data ?? [];
              if (items.length > 0) {
                customerId = items[0].id;
                await supabaseAdmin.from('proposals').update({ customer_lunarpay_id: customerId }).eq('id', p.id);
              }
            } catch { /* best-effort */ }
          }

          try {
            const sub = await getSubscription(venue.lunarpay_secret_key, p.subscription_id);
            return {
              id: p.id,
              description: `Proposal - ${p.customer_name}`,
              amount: sub.amount ?? p.price,
              frequency: sub.frequency ?? p.payment_config?.frequency ?? 'monthly',
              status: sub.status ?? p.status,
              nextPayment: sub.nextPaymentDate ?? null,
              subscriptionId: p.subscription_id,
              customerId,
              customerName: p.customer_name,
            };
          } catch {
            return {
              id: p.id,
              description: `Proposal - ${p.customer_name}`,
              amount: p.price,
              frequency: p.payment_config?.frequency ?? 'monthly',
              status: p.status,
              nextPayment: null,
              subscriptionId: p.subscription_id,
              customerId,
              customerName: p.customer_name,
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
