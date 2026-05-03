import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  STORYPAY_PLATFORM_DIRECTORY_META_KEY,
  loadVenueDirectoryPlanContext,
  requirePlatformLunarPaySecretKey,
} from '@/lib/platform-directory-billing';
import { createSubscription, getCheckoutSession } from '@/lib/lunarpay';
import { computeMonthlyTotalCents } from '@/lib/directory-addons';
import { listDirectoryPlanCatalog, loadAddonPrices } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/venue-billing/start-paid/verify
 * Body: { session_id: string }
 *
 * Closes the trial → paid hand-off after the venue enters their card on
 * LunarPay's checkout. Creates a subscription whose `startOn` is the trial
 * end date (or today if the trial already expired) so the first charge fires
 * exactly when expected.
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

  const meta = (session.metadata && typeof session.metadata === 'object'
    ? (session.metadata as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  if (String(meta[STORYPAY_PLATFORM_DIRECTORY_META_KEY] ?? '') !== '1') {
    return NextResponse.json({ error: 'Invalid checkout session metadata' }, { status: 400 });
  }
  if (String(meta.venue_id ?? '') !== venueId) {
    return NextResponse.json({ error: 'Checkout session does not match venue' }, { status: 400 });
  }
  if (String(meta.action ?? '') !== 'start_paid_after_trial') {
    return NextResponse.json(
      { error: 'Use the right verify endpoint for this checkout' },
      { status: 400 },
    );
  }

  const customerId =
    (session.customer_id as string | number | null) ||
    (session.customerId as string | number | null) ||
    ctx.venue.platform_lunarpay_customer_id;
  const paymentMethodId =
    (session.payment_method_id as string | number | null) ||
    (session.paymentMethodId as string | number | null) ||
    (session.payment_method as string | number | null);
  if (!customerId || !paymentMethodId) {
    return NextResponse.json(
      { error: 'Missing customer or payment method from checkout session' },
      { status: 400 },
    );
  }

  // Recompute total to make sure we're billing what's currently on file
  // (addons may have changed during the trial).
  const { data: row } = await supabaseAdmin
    .from('venues')
    .select('directory_addon_verified, directory_addon_sponsored, directory_addon_concierge, directory_trial_ends_at')
    .eq('id', venueId)
    .maybeSingle();
  const r = (row ?? {}) as Record<string, unknown>;
  const addonVerifiedUser  = Boolean(r.directory_addon_verified);
  const addonSponsoredUser = Boolean(r.directory_addon_sponsored);
  const addonConciergeUser = Boolean(r.directory_addon_concierge);

  const [allPlans, addonPrices] = await Promise.all([
    listDirectoryPlanCatalog(),
    loadAddonPrices(),
  ]);
  const currentPlan = allPlans.find((p) => p.id === ctx.venue.directory_plan_id) ?? null;
  const charge = computeMonthlyTotalCents({
    plan: currentPlan,
    allPlans,
    addonVerifiedUser,
    addonSponsoredUser,
    addonConciergeUser,
    prices: addonPrices,
  });
  if (charge.total_cents <= 0) {
    return NextResponse.json({ error: 'Total monthly is $0' }, { status: 400 });
  }

  // Schedule the first charge for trial end if still in the future, else
  // today (LunarPay will charge immediately).
  const today = new Date();
  const trialEndsRaw = (r.directory_trial_ends_at as string | null) ?? null;
  let startOn = today.toISOString().slice(0, 10);
  if (trialEndsRaw) {
    const ends = new Date(trialEndsRaw);
    if (!Number.isNaN(ends.getTime()) && ends.getTime() > today.getTime()) {
      startOn = ends.toISOString().slice(0, 10);
    }
  }

  const subResult = (await createSubscription(secret, {
    customerId: Number(customerId),
    paymentMethodId: Number(paymentMethodId),
    amount: charge.total_cents,
    frequency: 'monthly',
    startOn,
    description: `StoryVenue directory — ${currentPlan?.name ?? 'subscription'}`,
  })) as Record<string, unknown>;
  const sub = (subResult.data as Record<string, unknown>) || subResult;
  const subId = (sub.id as string | number | undefined) ?? null;
  if (subId === null) {
    return NextResponse.json({ error: 'LunarPay did not return a subscription id' }, { status: 502 });
  }

  await supabaseAdmin
    .from('venues')
    .update({
      directory_subscription_status: 'active',
      directory_subscription_external_id: String(subId),
      platform_lunarpay_customer_id: String(customerId),
    })
    .eq('id', venueId);

  await supabaseAdmin.from('platform_billing_events').insert({
    venue_id: venueId,
    directory_plan_id: currentPlan?.id ?? null,
    amount_cents: charge.total_cents,
    currency: 'usd',
    external_event_id: `start_paid:${sessionId}`,
    event_type: 'subscription_start_after_trial',
    metadata: {
      session_id: sessionId,
      subscription_id: String(subId),
      start_on: startOn,
      addon_verified: addonVerifiedUser,
      addon_sponsored: addonSponsoredUser,
    },
  });

  return NextResponse.json({
    ok: true,
    subscription_id: String(subId),
    total_cents: charge.total_cents,
    start_on: startOn,
  });
}
