import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  loadVenueDirectoryPlanContext,
  requirePlatformLunarPaySecretKey,
} from '@/lib/platform-directory-billing';
import { getCheckoutSession } from '@/lib/lunarpay';

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
  if (session.status !== 'completed') {
    return NextResponse.json(
      { error: `Checkout not completed (status: ${String(session.status)})` },
      { status: 400 },
    );
  }

  // LP subscription-mode sessions include the subscription ID in the
  // completed response. Try several possible field names.
  const subId =
    (session.subscription_id as string | number | null) ??
    (session.subscriptionId as string | number | null) ??
    ((session.subscription as Record<string, unknown> | null)?.id as string | number | null | undefined) ??
    null;

  const customerId =
    (session.customer_id as string | number | null) ||
    (session.customerId as string | number | null) ||
    ctx.venue.platform_lunarpay_customer_id;

  if (subId === null) {
    return NextResponse.json(
      { error: 'LunarPay session did not return a subscription_id — expected mode:subscription' },
      { status: 502 },
    );
  }

  await supabaseAdmin
    .from('venues')
    .update({
      directory_subscription_status: 'active',
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
