import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  loadVenueDirectoryPlanContext,
  getPlatformLunarPaySecretKey,
  requirePlatformLunarPaySecretKey,
  STORYPAY_PLATFORM_DIRECTORY_META_KEY,
} from '@/lib/platform-directory-billing';
import {
  cancelSubscription,
  updateSubscription,
  createCheckoutSession,
} from '@/lib/lunarpay';
import {
  computeMonthlyTotalCents,
} from '@/lib/directory-addons';
import { listDirectoryPlanCatalog } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';

/**
 * POST /api/venue-billing/addons
 *
 * Body: { verified?: boolean, sponsored?: boolean }
 *
 * Toggles the venue's add-on subscriptions. Recalculates the total monthly
 * charge (plan price + active add-ons that aren't already plan-included) and
 * pushes the new amount to LunarPay. Three flows:
 *
 *  1. New total > 0 with an active LunarPay subscription
 *     → PATCH the subscription amount.
 *
 *  2. New total > 0 with NO active subscription (e.g. free plan owner adds
 *     their first paid addon) → return a checkout URL so they can enter a card.
 *
 *  3. New total === 0 with an active subscription (e.g. user removes the only
 *     paid addon while on a free plan) → cancel the LunarPay subscription.
 *
 * The verified/sponsored *statuses* (admin approval flow) are also nudged so
 * the public listing badge stays correct: enabling sets to 'pending' if not
 * already approved/draft; disabling resets to 'none' so the badge stops
 * showing on the directory.
 */

interface Body {
  verified?: boolean;
  sponsored?: boolean;
}

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

async function recordBillingEvent(
  venueId: string,
  planId: string | null,
  amountCents: number,
  eventType: string,
  externalEventId: string,
  metadata: Record<string, unknown> = {},
) {
  await supabaseAdmin.from('platform_billing_events').insert({
    venue_id: venueId,
    directory_plan_id: planId,
    amount_cents: amountCents,
    currency: 'usd',
    external_event_id: externalEventId,
    event_type: eventType,
    metadata,
  });
}

export async function POST(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const ctx = await loadVenueDirectoryPlanContext(venueId);
  if (!ctx) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  // Read existing addon flags so we only flip what was sent
  const { data: addonRow } = await supabaseAdmin
    .from('venues')
    .select('directory_addon_verified, directory_addon_sponsored, directory_verified_status, directory_sponsored_status')
    .eq('id', venueId)
    .maybeSingle();

  if (!addonRow) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  const prevVerified = Boolean((addonRow as { directory_addon_verified?: boolean }).directory_addon_verified);
  const prevSponsored = Boolean((addonRow as { directory_addon_sponsored?: boolean }).directory_addon_sponsored);
  const nextVerified = typeof body.verified === 'boolean' ? body.verified : prevVerified;
  const nextSponsored = typeof body.sponsored === 'boolean' ? body.sponsored : prevSponsored;

  const allPlans = await listDirectoryPlanCatalog();
  const currentPlan = allPlans.find((p) => p.id === ctx.venue.directory_plan_id) ?? null;

  const prevCharge = computeMonthlyTotalCents({
    plan: currentPlan,
    allPlans,
    addonVerifiedUser: prevVerified,
    addonSponsoredUser: prevSponsored,
  });
  const nextCharge = computeMonthlyTotalCents({
    plan: currentPlan,
    allPlans,
    addonVerifiedUser: nextVerified,
    addonSponsoredUser: nextSponsored,
  });

  const subId = ctx.venue.directory_subscription_external_id;
  const status = ctx.venue.directory_subscription_status;
  // A LunarPay sub is only "real" with an external id; trialing venues don't
  // have one yet (they activate when card is added at trial end).
  const hasActiveSub = Boolean(subId && (status === 'active' || status === 'past_due'));
  const isTrialing = status === 'trialing';

  // ── Trial case ──────────────────────────────────────────────────────────
  // During an active trial we just persist the addon flags — nothing to bill.
  // The first charge (computed from plan + active addons at that moment) fires
  // when the venue adds a card and the LunarPay sub is created with
  // startOn = trial_ends_at.
  if (isTrialing) {
    await applyAddonFlagsAndStatus(venueId, currentPlan?.id ?? null, {
      verified: nextVerified,
      sponsored: nextSponsored,
      prevVerifiedStatus: String((addonRow as { directory_verified_status?: string }).directory_verified_status ?? 'none'),
      prevSponsoredStatus: String((addonRow as { directory_sponsored_status?: string }).directory_sponsored_status ?? 'none'),
    });
    return NextResponse.json({
      kind: 'switched',
      total_cents: nextCharge.total_cents,
      trialing: true,
    });
  }

  // ── Flow 2: NO subscription yet, but addons now create a non-zero total ─
  // The owner needs to enter a card. We don't write the addon flags yet —
  // only after checkout completes will the verify webhook flip them.
  if (!hasActiveSub && nextCharge.total_cents > 0) {
    const secret = requirePlatformLunarPaySecretKey();
    const checkoutData: Record<string, unknown> = {
      amount: nextCharge.total_cents / 100,
      description: 'StoryVenue directory — add-ons (monthly)',
      customer_email: ctx.venue.email || undefined,
      customer_name: ctx.venue.name,
      success_url: `${APP_URL}/dashboard/directory-billing?addons=1`,
      cancel_url: `${APP_URL}/dashboard/directory-billing`,
      save_payment_method: true,
      metadata: {
        [STORYPAY_PLATFORM_DIRECTORY_META_KEY]: '1',
        venue_id: venueId,
        directory_plan_id: currentPlan?.id ?? null,
        addon_verified: nextVerified ? '1' : '0',
        addon_sponsored: nextSponsored ? '1' : '0',
        action: 'addon_subscribe',
      },
    };
    if (ctx.venue.platform_lunarpay_customer_id) {
      checkoutData.customer_id = ctx.venue.platform_lunarpay_customer_id;
    }
    const result = await createCheckoutSession(secret, checkoutData);
    const session = (result as { data?: { url?: string }; url?: string }).data || result;
    const url = (session as { url?: string }).url;
    if (!url) throw new Error('LunarPay did not return a checkout URL');

    return NextResponse.json({
      kind: 'checkout_required',
      url,
      pending_addons: { verified: nextVerified, sponsored: nextSponsored },
    });
  }

  // ── Flow 3: Total drops to 0 — cancel the sub if any ───────────────────
  if (nextCharge.total_cents === 0) {
    if (hasActiveSub && subId) {
      const secret = getPlatformLunarPaySecretKey();
      if (secret) {
        try {
          await cancelSubscription(secret, subId);
        } catch {
          // best-effort: still flip the local flags
        }
      }
      await recordBillingEvent(
        venueId,
        currentPlan?.id ?? null,
        0,
        'subscription_cancel',
        `addon_off:${venueId}:${Date.now()}`,
        { reason: 'addons_total_zero', previous_subscription_id: subId },
      );
    }
    await applyAddonFlagsAndStatus(venueId, currentPlan?.id ?? null, {
      verified: nextVerified,
      sponsored: nextSponsored,
      prevVerifiedStatus: String((addonRow as { directory_verified_status?: string }).directory_verified_status ?? 'none'),
      prevSponsoredStatus: String((addonRow as { directory_sponsored_status?: string }).directory_sponsored_status ?? 'none'),
      clearSubscription: true,
    });
    return NextResponse.json({ kind: 'switched', total_cents: 0 });
  }

  // ── Flow 1: PATCH subscription amount ──────────────────────────────────
  if (hasActiveSub && subId) {
    const secret = requirePlatformLunarPaySecretKey();
    if (nextCharge.total_cents !== prevCharge.total_cents) {
      try {
        await updateSubscription(secret, subId, { amount: nextCharge.total_cents });
      } catch (e) {
        return NextResponse.json(
          {
            error: `LunarPay rejected the add-on change: ${e instanceof Error ? e.message : 'unknown error'}`,
          },
          { status: 502 },
        );
      }
    }
    await applyAddonFlagsAndStatus(venueId, currentPlan?.id ?? null, {
      verified: nextVerified,
      sponsored: nextSponsored,
      prevVerifiedStatus: String((addonRow as { directory_verified_status?: string }).directory_verified_status ?? 'none'),
      prevSponsoredStatus: String((addonRow as { directory_sponsored_status?: string }).directory_sponsored_status ?? 'none'),
    });
    await recordBillingEvent(
      venueId,
      currentPlan?.id ?? null,
      nextCharge.total_cents,
      'addon_change',
      `addon_change:${venueId}:${Date.now()}`,
      {
        previous_amount_cents: prevCharge.total_cents,
        new_amount_cents: nextCharge.total_cents,
        verified: nextVerified,
        sponsored: nextSponsored,
        subscription_id: subId,
      },
    );
    return NextResponse.json({ kind: 'switched', total_cents: nextCharge.total_cents });
  }

  // No subscription, total is 0 — just flip the flags (e.g. on a top plan that
  // includes everything for free).
  await applyAddonFlagsAndStatus(venueId, currentPlan?.id ?? null, {
    verified: nextVerified,
    sponsored: nextSponsored,
    prevVerifiedStatus: String((addonRow as { directory_verified_status?: string }).directory_verified_status ?? 'none'),
    prevSponsoredStatus: String((addonRow as { directory_sponsored_status?: string }).directory_sponsored_status ?? 'none'),
  });
  return NextResponse.json({ kind: 'switched', total_cents: 0 });
}

/**
 * Persist the addon flags AND nudge the corresponding admin-approval status
 * so the public-listing badge stays correct.
 *
 * Status transitions:
 *   • Enable an addon when status is none/rejected → status becomes 'pending'
 *     (admin reviews; until approved, the public badge does NOT show).
 *   • Disable an addon when status was approved/pending → status becomes 'none'
 *     (badge disappears immediately).
 *   • If status was already approved AND the user is re-enabling, leave it
 *     alone (don't disrupt a live badge for a billing toggle).
 */
async function applyAddonFlagsAndStatus(
  venueId: string,
  _planId: string | null,
  opts: {
    verified: boolean;
    sponsored: boolean;
    prevVerifiedStatus: string;
    prevSponsoredStatus: string;
    clearSubscription?: boolean;
  },
) {
  const verifiedStatus = nextStatus(opts.verified, opts.prevVerifiedStatus);
  const sponsoredStatus = nextStatus(opts.sponsored, opts.prevSponsoredStatus);

  const update: Record<string, unknown> = {
    directory_addon_verified: opts.verified,
    directory_addon_sponsored: opts.sponsored,
    directory_verified_status: verifiedStatus,
    directory_sponsored_status: sponsoredStatus,
  };
  if (opts.clearSubscription) {
    update.directory_subscription_status = 'none';
    update.directory_subscription_external_id = null;
  }
  await supabaseAdmin.from('venues').update(update).eq('id', venueId);
}

function nextStatus(enabled: boolean, prev: string): string {
  if (enabled) {
    if (prev === 'approved' || prev === 'pending' || prev === 'draft') return prev;
    return 'pending';
  }
  return 'none';
}
