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
import { listDirectoryPlanCatalog } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/venue-billing/addons/verify
 * Body: { session_id: string }
 *
 * Final step in the "free-tier owner subscribes to an addon" flow:
 *   1. /addons   → no card on file, returns checkout_required URL
 *   2. user enters card on LunarPay, lands back on the dashboard
 *   3. this endpoint runs once, reads the saved card + addon flags from
 *      session metadata, creates a LunarPay subscription at the new total,
 *      and flips the venue's addon flags + status to pending.
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
  if (!ctx) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  const result = (await getCheckoutSession(secret, sessionId)) as Record<string, unknown>;
  const session = (result.data as Record<string, unknown>) || result;
  if (session.status !== 'completed') {
    return NextResponse.json(
      { error: `Checkout not completed (status: ${String(session.status)})` },
      { status: 400 },
    );
  }

  // Pull metadata
  const meta = (session.metadata && typeof session.metadata === 'object'
    ? (session.metadata as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  if (String(meta[STORYPAY_PLATFORM_DIRECTORY_META_KEY] ?? '') !== '1') {
    return NextResponse.json({ error: 'Invalid checkout session metadata' }, { status: 400 });
  }
  if (String(meta.venue_id ?? '') !== venueId) {
    return NextResponse.json({ error: 'Checkout session does not match venue' }, { status: 400 });
  }
  if (String(meta.action ?? '') !== 'addon_subscribe') {
    return NextResponse.json(
      { error: 'Use the regular plan verify for non-addon checkouts' },
      { status: 400 },
    );
  }

  const addonVerified   = String(meta.addon_verified   ?? '0') === '1';
  const addonSponsored  = String(meta.addon_sponsored  ?? '0') === '1';
  const addonConcierge  = String(meta.addon_concierge  ?? '0') === '1';

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

  // Recompute the charge amount with the current plan + new addon flags.
  const allPlans = await listDirectoryPlanCatalog();
  const currentPlan = allPlans.find((p) => p.id === ctx.venue.directory_plan_id) ?? null;
  const charge = computeMonthlyTotalCents({
    plan: currentPlan,
    allPlans,
    addonVerifiedUser:  addonVerified,
    addonSponsoredUser: addonSponsored,
    addonConciergeUser: addonConcierge,
  });
  if (charge.total_cents <= 0) {
    return NextResponse.json({ error: 'Computed charge is zero — nothing to subscribe to' }, { status: 400 });
  }

  const startOn = new Date().toISOString().slice(0, 10);
  const subResult = (await createSubscription(secret, {
    customerId: Number(customerId),
    paymentMethodId: Number(paymentMethodId),
    amount: charge.total_cents,
    frequency: 'monthly',
    startOn,
    description: 'StoryVenue directory — add-ons',
  })) as Record<string, unknown>;
  const sub = (subResult.data as Record<string, unknown>) || subResult;
  const subId = (sub.id as string | number | undefined) ?? null;
  if (subId === null) {
    return NextResponse.json({ error: 'LunarPay did not return a subscription id' }, { status: 502 });
  }

  // Status transitions for the public-listing badge — pending review by admin.
  const { data: vRow } = await supabaseAdmin
    .from('venues')
    .select('directory_verified_status, directory_sponsored_status')
    .eq('id', venueId)
    .maybeSingle();
  const prevV = String((vRow as { directory_verified_status?: string } | null)?.directory_verified_status ?? 'none');
  const prevS = String((vRow as { directory_sponsored_status?: string } | null)?.directory_sponsored_status ?? 'none');
  const verifiedStatus = addonVerified
    ? prevV === 'approved' || prevV === 'pending' || prevV === 'draft'
      ? prevV
      : 'pending'
    : prevV;
  const sponsoredStatus = addonSponsored
    ? prevS === 'approved' || prevS === 'pending' || prevS === 'draft'
      ? prevS
      : 'pending'
    : prevS;

  await supabaseAdmin
    .from('venues')
    .update({
      directory_addon_verified:   addonVerified,
      directory_addon_sponsored:  addonSponsored,
      directory_addon_concierge:  addonConcierge,
      directory_verified_status:  verifiedStatus,
      directory_sponsored_status: sponsoredStatus,
      directory_subscription_status:      'active',
      directory_subscription_external_id: String(subId),
      platform_lunarpay_customer_id:      String(customerId),
    })
    .eq('id', venueId);

  await supabaseAdmin.from('platform_billing_events').insert({
    venue_id: venueId,
    directory_plan_id: ctx.venue.directory_plan_id ?? null,
    amount_cents: charge.total_cents,
    currency: 'usd',
    external_event_id: `addon_checkout:${sessionId}`,
    event_type: 'subscription_start',
    metadata: {
      session_id:      sessionId,
      subscription_id: String(subId),
      addon_verified:  addonVerified,
      addon_sponsored: addonSponsored,
      addon_concierge: addonConcierge,
    },
  });

  return NextResponse.json({ ok: true, subscription_id: String(subId), total_cents: charge.total_cents });
}
