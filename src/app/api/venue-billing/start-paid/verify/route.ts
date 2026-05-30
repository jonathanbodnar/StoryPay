import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  loadVenueDirectoryPlanContext,
  requirePlatformLunarPaySecretKey,
} from '@/lib/platform-directory-billing';
import { getCheckoutSession, listSubscriptions } from '@/lib/lunarpay';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/venue-billing/start-paid/verify
 * Body: { session_id: string }
 *
 * The start-paid checkout now uses mode:"subscription" so LP has already
 * charged the card, vaulted it, and created the recurring subscription.
 * All we need to do here is read the subscription_id from the completed
 * session and persist it locally.
 */
export async function POST(req: NextRequest) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { session_id?: string };
  const sessionId = body.session_id;
  if (!sessionId) return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });

  const secret = requirePlatformLunarPaySecretKey();
  const ctx = await loadVenueDirectoryPlanContext(venueId);
  if (!ctx?.plan) {
    return NextResponse.json({ error: 'No directory plan assigned' }, { status: 400 });
  }

  const result = (await getCheckoutSession(secret, sessionId)) as Record<string, unknown>;
  const session = (result.data as Record<string, unknown>) || result;
  // 'completed'      → card charged immediately (expired-trial / wall path).
  // 'trial_started'  → card vaulted, first charge scheduled for the trial-end
  //                    date (the "Start Venue Pro early" path). Both are
  //                    success states; we just persist the subscription.
  const isTrialStart = session.status === 'trial_started';
  if (session.status !== 'completed' && !isTrialStart) {
    return NextResponse.json(
      { error: `Checkout not completed (status: ${String(session.status)})` },
      { status: 400 },
    );
  }

  // LP subscription-mode sessions include the subscription ID in the
  // completed response. NOTE: LP's GET /checkout/sessions often omits
  // subscription_id — fall back to listSubscriptions if needed.
  let subId: string | number | null =
    (session.subscription_id as string | number | null) ??
    (session.subscriptionId as string | number | null) ??
    ((session.subscription as Record<string, unknown> | null)?.id as string | number | null | undefined) ??
    null;

  let customerId: string | number | null =
    (session.customer_id as string | number | null) ||
    (session.customerId as string | number | null) ||
    ctx.venue.platform_lunarpay_customer_id ||
    null;

  if (subId === null) {
    try {
      const allSubs = await listSubscriptions(secret);
      const subList: Record<string, unknown>[] = Array.isArray(allSubs)
        ? allSubs
        : ((allSubs as Record<string, unknown>).data as Record<string, unknown>[]) ?? [];
      const match = subList.find(
        (s) => s.status !== 'cancelled' && s.status !== 'canceled',
      );
      if (match?.id) {
        subId = match.id as string | number;
        if (!customerId)
          customerId =
            (match.customer_id as string | number | null) ??
            (match.customerId as string | number | null) ??
            null;
        console.log('[start-paid/verify] found sub via listSubscriptions:', subId);
      }
    } catch (e) {
      console.warn('[start-paid/verify] listSubscriptions fallback failed:', e);
    }
  }

  if (subId === null) {
    return NextResponse.json(
      { error: 'Could not find the subscription LP created — please contact support.' },
      { status: 422 },
    );
  }

  await supabaseAdmin
    .from('venues')
    .update({
      // Card added early stays 'trialing' (with a sub on file) until the trial
      // ends and the first charge fires; an immediate charge becomes 'active'.
      directory_subscription_status: isTrialStart ? 'trialing' : 'active',
      directory_subscription_external_id: String(subId),
      platform_lunarpay_customer_id: customerId ? String(customerId) : undefined,
    })
    .eq('id', venueId);

  await supabaseAdmin.from('platform_billing_events').insert({
    venue_id: venueId,
    directory_plan_id: ctx.plan.id,
    amount_cents: ctx.plan.price_monthly_cents ?? 0,
    currency: 'usd',
    external_event_id: `start_paid:${sessionId}`,
    event_type: 'subscription_start_after_trial',
    metadata: {
      session_id: sessionId,
      subscription_id: String(subId),
      mode: 'subscription',
    },
  });

  return NextResponse.json({
    ok: true,
    subscription_id: String(subId),
  });
}
