import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { listPaymentSchedules, listSubscriptions, listCustomers } from '@/lib/lunarpay';

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
    return NextResponse.json({ error: 'StoryPay merchant account is not yet configured' }, { status: 400 });
  }

  const secret = venue.lunarpay_secret_key;

  try {
    if (type === 'charges') {
      // Include all paid proposals (including refunded ones so the history is complete)
      const { data: proposals } = await supabaseAdmin
        .from('proposals')
        .select('id, customer_name, customer_email, customer_lunarpay_id, price, status, charge_id, checkout_session_id, transaction_id, paid_at, refunded_at, created_at')
        .eq('venue_id', venueId)
        .in('status', ['paid', 'refunded', 'partial_refund'])
        .order('paid_at', { ascending: false });

      const resolved = await Promise.all(
        (proposals ?? []).map(async (p) => {
          let customerId = p.customer_lunarpay_id ?? null;

          if (!customerId && p.customer_email) {
            try {
              const result = await listCustomers(secret, p.customer_email, 1, 1);
              const items = Array.isArray(result) ? result : result.data ?? [];
              if (items.length > 0) {
                customerId = items[0].id;
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
            refundedAt: p.refunded_at || null,
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
      // Build a proposal lookup by payment_schedule_id for customer names
      const { data: proposals } = await supabaseAdmin
        .from('proposals')
        .select('id, customer_name, customer_email, customer_lunarpay_id, payment_schedule_id')
        .eq('venue_id', venueId)
        .not('payment_schedule_id', 'is', null);

      const customerMap: Record<string, { customerId: string | null; customerName: string | null }> = {};
      for (const p of proposals ?? []) {
        if (!p.payment_schedule_id) continue;
        let customerId = p.customer_lunarpay_id ?? null;
        if (!customerId && p.customer_email) {
          try {
            const result = await listCustomers(secret, p.customer_email, 1, 1);
            const items = Array.isArray(result) ? result : result.data ?? [];
            if (items.length > 0) {
              customerId = items[0].id;
              await supabaseAdmin.from('proposals').update({ customer_lunarpay_id: customerId }).eq('id', p.id);
            }
          } catch { /* best-effort */ }
        }
        customerMap[String(p.payment_schedule_id)] = {
          customerId,
          customerName: p.customer_name ?? null,
        };
      }

      // Fetch ALL schedules from LP (active, completed, and cancelled)
      const schedules = await listPaymentSchedules(secret);
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
      // Build a proposal lookup by subscription_id for customer names
      const { data: proposals } = await supabaseAdmin
        .from('proposals')
        .select('id, customer_name, customer_email, customer_lunarpay_id, subscription_id')
        .eq('venue_id', venueId)
        .not('subscription_id', 'is', null);

      const proposalMap: Record<string, { proposalId: string; customerName: string | null; customerId: string | null }> = {};
      for (const p of proposals ?? []) {
        if (!p.subscription_id) continue;
        let customerId = p.customer_lunarpay_id ?? null;
        if (!customerId && p.customer_email) {
          try {
            const result = await listCustomers(secret, p.customer_email, 1, 1);
            const items = Array.isArray(result) ? result : result.data ?? [];
            if (items.length > 0) {
              customerId = items[0].id;
              await supabaseAdmin.from('proposals').update({ customer_lunarpay_id: customerId }).eq('id', p.id);
            }
          } catch { /* best-effort */ }
        }
        proposalMap[String(p.subscription_id)] = {
          proposalId: p.id,
          customerName: p.customer_name ?? null,
          customerId,
        };
      }

      // Fetch ALL subscriptions from LP (active and cancelled)
      const lpSubs = await listSubscriptions(secret);
      const subList = (Array.isArray(lpSubs) ? lpSubs : lpSubs.data ?? []) as Record<string, unknown>[];

      const subscriptions = subList.map((sub) => {
        const linked = proposalMap[String(sub.id)];
        return {
          id: linked?.proposalId ?? null,
          description: linked?.customerName ? `Proposal - ${linked.customerName}` : `Subscription #${sub.id}`,
          amount: sub.amount ?? 0,
          frequency: sub.frequency ?? 'monthly',
          status: sub.status ?? 'unknown',
          nextPayment: sub.nextPaymentDate ?? sub.nextPaymentOn ?? null,
          startOn: sub.startOn ?? null,
          subscriptionId: sub.id,
          customerId: linked?.customerId ?? sub.customerId ?? null,
          customerName: linked?.customerName ?? null,
        };
      });

      return NextResponse.json(subscriptions);
    }

    return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 });
  } catch (err) {
    console.error('Transactions fetch error:', err);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}
