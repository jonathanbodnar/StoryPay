import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { cancelSubscription, refundCharge, getSubscription } from '@/lib/lunarpay';
import { requirePlatformLunarPaySecretKey } from '@/lib/platform-directory-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/venues/[id]/billing-action
 *
 * Admin-only endpoint for managing a venue's SaaS subscription without
 * needing to log into the LunarPay dashboard.
 *
 * Body:
 *   { action: 'cancel_subscription' }
 *     — Cancels the venue's active directory subscription on LunarPay and
 *       stamps directory_subscription_status = 'canceled' locally.
 *
 *   { action: 'refund_charge', charge_id: string, amount_cents?: number }
 *     — Issues a full or partial refund for a specific LunarPay charge.
 *       Omit amount_cents for a full refund.
 *
 *   { action: 'fetch_subscription' }
 *     — Returns the live subscription data from LunarPay for the venue.
 *       Read-only; useful for checking status / next payment date.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: venueId } = await params;
  if (!venueId) return NextResponse.json({ error: 'Missing venue id' }, { status: 400 });

  const ALLOWED_MANUAL_STATUSES = ['active', 'trialing', 'past_due', 'canceled', 'pending'] as const;
type AllowedStatus = typeof ALLOWED_MANUAL_STATUSES[number];

let body: { action?: string; charge_id?: string; amount_cents?: number; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action } = body;
  if (!action) return NextResponse.json({ error: 'Missing action' }, { status: 400 });

  // Load venue + current subscription id
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select(
      'id, name, directory_subscription_external_id, directory_subscription_status, directory_plan_id, platform_lunarpay_customer_id',
    )
    .eq('id', venueId)
    .maybeSingle();

  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  const v = venue as Record<string, unknown>;
  const subId = v.directory_subscription_external_id as string | null;

  // ── Stripe-billed venue (the owner's Stripe account) ─────────────────────
  if (subId && subId.startsWith('sub_')) {
    const { getStripe } = await import('@/lib/stripe/client');
    const stripe = getStripe();
    if (action === 'fetch_subscription') {
      try {
        return NextResponse.json({ subscription: await stripe.subscriptions.retrieve(subId), provider: 'stripe' });
      } catch (e) {
        return NextResponse.json({ error: `Could not fetch subscription: ${e instanceof Error ? e.message : 'Stripe error'}` }, { status: 502 });
      }
    }
    if (action === 'cancel_subscription') {
      try {
        const { cancelVenueSubscriptionStripe } = await import('@/lib/stripe/billing');
        await cancelVenueSubscriptionStripe(venueId);
        return NextResponse.json({ ok: true, canceled_subscription_id: subId, provider: 'stripe' });
      } catch (e) {
        return NextResponse.json({ error: `Stripe returned an error: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 });
      }
    }
    if (action === 'refund_charge') {
      const ref = body.charge_id?.trim();
      if (!ref) return NextResponse.json({ error: 'charge_id is required (a Stripe ch_, pi_ or in_ id)' }, { status: 400 });
      try {
        let paymentIntent: string | undefined;
        let charge: string | undefined;
        if (ref.startsWith('in_')) {
          const payments = await stripe.invoicePayments.list({ invoice: ref, limit: 1 });
          const pi = payments.data[0]?.payment?.payment_intent;
          paymentIntent = typeof pi === 'string' ? pi : pi?.id;
        } else if (ref.startsWith('pi_')) paymentIntent = ref;
        else charge = ref;
        const refund = await stripe.refunds.create({
          ...(paymentIntent ? { payment_intent: paymentIntent } : { charge }),
          ...(typeof body.amount_cents === 'number' && body.amount_cents > 0 ? { amount: Math.round(body.amount_cents) } : {}),
        });
        await supabaseAdmin.from('platform_billing_events').insert({
          venue_id: venueId,
          directory_plan_id: (v.directory_plan_id as string | null) ?? null,
          amount_cents: -(refund.amount ?? 0),
          currency: 'usd',
          external_event_id: `stripe_refund:${refund.id}`,
          event_type: 'refund',
          provider: 'stripe',
          metadata: { refund_id: refund.id, reference: ref, admin_action: true },
        });
        return NextResponse.json({ ok: true, refund, provider: 'stripe' });
      } catch (e) {
        return NextResponse.json({ error: `Stripe refund failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 });
      }
    }
  }

  // set_status only writes the venue row, so it must not need LunarPay (Stripe
  // venues use it too).
  let secret = '';
  if (action !== 'set_status') {
    try {
      secret = requirePlatformLunarPaySecretKey();
    } catch {
      return NextResponse.json(
        { error: 'Platform LunarPay key not configured. Check STORYPAY_HQ_LUNARPAY_SK env var.' },
        { status: 503 },
      );
    }
  }

  // ── fetch_subscription ────────────────────────────────────────────────────
  if (action === 'fetch_subscription') {
    if (!subId) {
      return NextResponse.json({ subscription: null, message: 'No subscription on file for this venue.' });
    }
    try {
      const raw = await getSubscription(secret, subId);
      const sub = (raw as { data?: unknown }).data ?? raw;
      return NextResponse.json({ subscription: sub });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'LunarPay error';
      return NextResponse.json({ error: `Could not fetch subscription: ${msg}` }, { status: 502 });
    }
  }

  // ── cancel_subscription ───────────────────────────────────────────────────
  if (action === 'cancel_subscription') {
    if (!subId) {
      return NextResponse.json(
        { error: 'This venue has no active subscription on file.' },
        { status: 400 },
      );
    }

    try {
      await cancelSubscription(secret, subId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'LunarPay error';
      console.error('[admin/billing-action] cancelSubscription failed:', msg);
      return NextResponse.json(
        { error: `LunarPay returned an error: ${msg}` },
        { status: 502 },
      );
    }

    // Update DB to reflect cancellation
    await supabaseAdmin
      .from('venues')
      .update({ directory_subscription_status: 'canceled' })
      .eq('id', venueId);

    // Log event
    await supabaseAdmin.from('platform_billing_events').insert({
      venue_id:          venueId,
      directory_plan_id: (v.directory_plan_id as string | null) ?? null,
      amount_cents:      0,
      currency:          'usd',
      external_event_id: `admin_cancel:${subId}`,
      event_type:        'subscription_canceled_by_admin',
      metadata:          { subscription_id: subId, admin_action: true },
    });

    console.log('[admin/billing-action] canceled subscription', subId, 'for venue', venueId);
    return NextResponse.json({ ok: true, canceled_subscription_id: subId });
  }

  // ── refund_charge ─────────────────────────────────────────────────────────
  if (action === 'refund_charge') {
    const chargeId = body.charge_id?.trim();
    if (!chargeId) {
      return NextResponse.json({ error: 'charge_id is required' }, { status: 400 });
    }

    const amountCents =
      typeof body.amount_cents === 'number' && body.amount_cents > 0
        ? body.amount_cents
        : undefined; // undefined = full refund

    try {
      const result = await refundCharge(secret, chargeId, amountCents);
      const refund = (result as { data?: unknown }).data ?? result;
      console.log('[admin/billing-action] refunded charge', chargeId, 'for venue', venueId);

      // Log event
      await supabaseAdmin.from('platform_billing_events').insert({
        venue_id:          venueId,
        directory_plan_id: (v.directory_plan_id as string | null) ?? null,
        amount_cents:      amountCents != null ? -amountCents : 0,
        currency:          'usd',
        external_event_id: `admin_refund:${chargeId}`,
        event_type:        'charge_refunded_by_admin',
        metadata:          { charge_id: chargeId, amount_cents: amountCents ?? 'full', admin_action: true },
      });

      return NextResponse.json({ ok: true, refund });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'LunarPay error';
      console.error('[admin/billing-action] refundCharge failed:', msg);
      return NextResponse.json(
        { error: `LunarPay returned an error: ${msg}` },
        { status: 502 },
      );
    }
  }

  // ── set_status ────────────────────────────────────────────────────────────
  // Manual override for when LP data and local DB have drifted.  Does NOT
  // touch LunarPay — only adjusts the local directory_subscription_status so
  // the admin panel and entitlement gates reflect reality.
  if (action === 'set_status') {
    const newStatus = (body.status ?? '').trim() as AllowedStatus;
    if (!ALLOWED_MANUAL_STATUSES.includes(newStatus)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${ALLOWED_MANUAL_STATUSES.join(', ')}` },
        { status: 400 },
      );
    }
    await supabaseAdmin
      .from('venues')
      .update({ directory_subscription_status: newStatus })
      .eq('id', venueId);

    await supabaseAdmin.from('platform_billing_events').insert({
      venue_id:          venueId,
      directory_plan_id: (v.directory_plan_id as string | null) ?? null,
      amount_cents:      0,
      currency:          'usd',
      external_event_id: `admin_set_status:${venueId}:${Date.now()}`,
      event_type:        'admin_status_override',
      metadata:          { new_status: newStatus, previous_status: v.directory_subscription_status, admin_action: true },
    });

    console.log('[admin/billing-action] set_status', newStatus, 'for venue', venueId);
    return NextResponse.json({ ok: true, status: newStatus });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
