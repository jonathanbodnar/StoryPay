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
import { listDirectoryPlanCatalog, loadAddonPrices } from '@/lib/venue-billing';

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
  concierge?: boolean;
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
  try {
    return await handlePost(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Add-on update failed';
    const schemaMissing = /migration 092|undefined column|42703/i.test(msg);
    return NextResponse.json(
      { error: msg, schemaMissing: schemaMissing || undefined },
      { status: schemaMissing ? 503 : 500 },
    );
  }
}

async function handlePost(req: NextRequest) {
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

  // Read existing addon flags so we only flip what was sent. If migration 092
  // hasn't been applied yet, the addon columns don't exist — the SELECT will
  // error with code 42703 (undefined_column) and we return an actionable 503.
  const addonRowResp = await supabaseAdmin
    .from('venues')
    .select('directory_addon_verified, directory_addon_sponsored, directory_addon_concierge, directory_verified_status, directory_sponsored_status')
    .eq('id', venueId)
    .maybeSingle();

  if (addonRowResp.error) {
    // 42703 = undefined column → migration 092 hasn't run.
    // 42P01 = undefined table  → schema fully missing.
    const code = (addonRowResp.error as { code?: string }).code;
    if (code === '42703' || code === '42P01') {
      return NextResponse.json(
        {
          error:
            'Add-on subscriptions need a one-time database migration. Open the Supabase SQL editor and run migration 092 (directory_addon_verified / directory_addon_sponsored columns), then try again.',
          schemaMissing: true,
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: addonRowResp.error.message || 'Could not read add-on state' },
      { status: 500 },
    );
  }

  const addonRow = addonRowResp.data;
  if (!addonRow) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  const prevVerified   = Boolean((addonRow as Record<string, unknown>).directory_addon_verified);
  const prevSponsored  = Boolean((addonRow as Record<string, unknown>).directory_addon_sponsored);
  const prevConcierge  = Boolean((addonRow as Record<string, unknown>).directory_addon_concierge);
  const nextVerified   = typeof body.verified   === 'boolean' ? body.verified   : prevVerified;
  const nextSponsored  = typeof body.sponsored  === 'boolean' ? body.sponsored  : prevSponsored;
  const nextConcierge  = typeof body.concierge  === 'boolean' ? body.concierge  : prevConcierge;

  const [allPlans, addonPrices] = await Promise.all([
    listDirectoryPlanCatalog(),
    loadAddonPrices(),
  ]);
  const currentPlan = allPlans.find((p) => p.id === ctx.venue.directory_plan_id) ?? null;

  const prevCharge = computeMonthlyTotalCents({
    plan: currentPlan,
    allPlans,
    addonVerifiedUser:   prevVerified,
    addonSponsoredUser:  prevSponsored,
    addonConciergeUser:  prevConcierge,
    prices: addonPrices,
  });
  const nextCharge = computeMonthlyTotalCents({
    plan: currentPlan,
    allPlans,
    addonVerifiedUser:   nextVerified,
    addonSponsoredUser:  nextSponsored,
    addonConciergeUser:  nextConcierge,
    prices: addonPrices,
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
      verified:  nextVerified,
      sponsored: nextSponsored,
      concierge: nextConcierge,
      prevVerifiedStatus:  String((addonRow as Record<string, unknown>).directory_verified_status  ?? 'none'),
      prevSponsoredStatus: String((addonRow as Record<string, unknown>).directory_sponsored_status ?? 'none'),
    });
    return NextResponse.json({
      kind: 'switched',
      total_cents: nextCharge.total_cents,
      trialing: true,
    });
  }

  // ── Flow 2: NO subscription yet, but addons now create a non-zero total ─
  // The owner needs to enter a card. We don't write the addon flags yet —
  // only after checkout completes will the verify endpoint flip them.
  if (!hasActiveSub && nextCharge.total_cents > 0) {
    const secret = requirePlatformLunarPaySecretKey();
    const checkoutData: Record<string, unknown> = {
      amount: nextCharge.total_cents / 100,
      description: 'StoryVenue directory — add-ons (monthly)',
      customer_email: ctx.venue.email || undefined,
      customer_name: ctx.venue.name,
      success_url: `${APP_URL}/dashboard/directory-billing?addons=1`,
      cancel_url: `${APP_URL}/dashboard/directory-billing`,
      metadata: {
        [STORYPAY_PLATFORM_DIRECTORY_META_KEY]: '1',
        venue_id: venueId,
        directory_plan_id: currentPlan?.id ?? null,
        addon_verified:   nextVerified   ? '1' : '0',
        addon_sponsored:  nextSponsored  ? '1' : '0',
        addon_concierge:  nextConcierge  ? '1' : '0',
        action: 'addon_subscribe',
      },
    };

    try {
      const result = await createCheckoutSession(secret, checkoutData);
      const session = (result as { data?: { url?: string }; url?: string }).data || result;
      const url = (session as { url?: string }).url;
      if (!url) throw new Error('LunarPay did not return a checkout URL');

      return NextResponse.json({
        kind: 'checkout_required',
        url,
        pending_addons: { verified: nextVerified, sponsored: nextSponsored, concierge: nextConcierge },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not create checkout session';
      console.error('[addons] LunarPay error:', msg);
      return NextResponse.json({ error: msg }, { status: 502 });
    }
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
      verified:  nextVerified,
      sponsored: nextSponsored,
      concierge: nextConcierge,
      prevVerifiedStatus:  String((addonRow as Record<string, unknown>).directory_verified_status  ?? 'none'),
      prevSponsoredStatus: String((addonRow as Record<string, unknown>).directory_sponsored_status ?? 'none'),
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
      verified:  nextVerified,
      sponsored: nextSponsored,
      concierge: nextConcierge,
      prevVerifiedStatus:  String((addonRow as Record<string, unknown>).directory_verified_status  ?? 'none'),
      prevSponsoredStatus: String((addonRow as Record<string, unknown>).directory_sponsored_status ?? 'none'),
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
        verified:   nextVerified,
        sponsored:  nextSponsored,
        concierge:  nextConcierge,
        subscription_id: subId,
      },
    );
    return NextResponse.json({ kind: 'switched', total_cents: nextCharge.total_cents });
  }

  // No subscription, total is 0 — just flip the flags (e.g. on a top plan that
  // includes everything for free).
  await applyAddonFlagsAndStatus(venueId, currentPlan?.id ?? null, {
    verified:  nextVerified,
    sponsored: nextSponsored,
    concierge: nextConcierge,
    prevVerifiedStatus:  String((addonRow as Record<string, unknown>).directory_verified_status  ?? 'none'),
    prevSponsoredStatus: String((addonRow as Record<string, unknown>).directory_sponsored_status ?? 'none'),
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
    concierge: boolean;
    prevVerifiedStatus: string;
    prevSponsoredStatus: string;
    clearSubscription?: boolean;
  },
) {
  const verifiedStatus  = nextStatus(opts.verified,  opts.prevVerifiedStatus);
  const sponsoredStatus = nextStatus(opts.sponsored, opts.prevSponsoredStatus);

  const update: Record<string, unknown> = {
    directory_addon_verified:   opts.verified,
    directory_addon_sponsored:  opts.sponsored,
    directory_addon_concierge:  opts.concierge,
    directory_verified_status:  verifiedStatus,
    directory_sponsored_status: sponsoredStatus,
  };
  if (opts.clearSubscription) {
    update.directory_subscription_status = 'none';
    update.directory_subscription_external_id = null;
  }
  const upd = await supabaseAdmin.from('venues').update(update).eq('id', venueId);
  if (upd.error) {
    const code = (upd.error as { code?: string }).code;
    // Migration 092 not applied — drop the new flags and retry with the legacy
    // status-only update so the public badge state still gets nudged.
    if (code === '42703') {
      const fallback: Record<string, unknown> = {
        directory_verified_status:  verifiedStatus,
        directory_sponsored_status: sponsoredStatus,
      };
      if (opts.clearSubscription) {
        fallback.directory_subscription_status = 'none';
        fallback.directory_subscription_external_id = null;
      }
      await supabaseAdmin.from('venues').update(fallback).eq('id', venueId);
      throw new Error(
        'Add-on subscriptions need a one-time database migration (092). Run it in the Supabase SQL editor, then try again.',
      );
    }
    throw new Error(upd.error.message || 'Could not save add-on flags');
  }
}

function nextStatus(enabled: boolean, prev: string): string {
  if (enabled) {
    if (prev === 'approved' || prev === 'pending' || prev === 'draft') return prev;
    return 'pending';
  }
  return 'none';
}
