import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  loadVenueDirectoryPlanContext,
  requirePlatformLunarPaySecretKey,
} from '@/lib/platform-directory-billing';
import {
  createCustomer,
  listCustomers,
  savePaymentMethodFromVault,
  createSubscription,
} from '@/lib/lunarpay';
import { computeMonthlyTotalCents } from '@/lib/directory-addons';
import { listDirectoryPlanCatalog, loadAddonPrices } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/venue-billing/signup-checkout/confirm
 * Body: { vaultId: string; paymentMethod: string }
 *
 * Handles the tokenize_success event from Fortis Elements for SaaS trials.
 * 1. Finds or creates the LP customer for this venue.
 * 2. Saves the vaulted card as a payment method.
 * 3. Creates a LP subscription with startOn = trial end date (no charge today).
 * 4. Updates the venue row to trialing.
 * 5. Creates an audit log entry.
 */
export async function POST(req: NextRequest) {
  try {
    const c = await cookies();
    const venueId = c.get('venue_id')?.value;
    if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { vaultId?: string; paymentMethod?: string };
    const { vaultId, paymentMethod = 'cc' } = body;
    if (!vaultId) return NextResponse.json({ error: 'vaultId is required' }, { status: 400 });

    const ctx = await loadVenueDirectoryPlanContext(venueId);
    if (!ctx) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

    // ── Idempotency ──────────────────────────────────────────────────────────
    if (
      (ctx.venue as Record<string, unknown>).directory_subscription_external_id &&
      (ctx.venue as Record<string, unknown>).directory_subscription_status === 'trialing'
    ) {
      return NextResponse.json({ ok: true, already_processed: true });
    }

    const trialEndsAt = String((ctx.venue as Record<string, unknown>).directory_trial_ends_at ?? '');
    const planId      = String((ctx.venue as Record<string, unknown>).directory_plan_id ?? '');
    const trialStartedAt = String((ctx.venue as Record<string, unknown>).directory_trial_started_at ?? new Date().toISOString());

    if (!trialEndsAt || !planId) {
      return NextResponse.json({ error: 'Trial not set up. Please restart signup.' }, { status: 400 });
    }

    let secret: string;
    try {
      secret = requirePlatformLunarPaySecretKey();
    } catch {
      return NextResponse.json({ error: 'Payment system not configured.' }, { status: 503 });
    }

    // ── Compute billing amount ───────────────────────────────────────────────
    const [allPlans, addonPrices] = await Promise.all([
      listDirectoryPlanCatalog(),
      loadAddonPrices(),
    ]);
    const targetPlan = allPlans.find((p) => p.id === planId);
    if (!targetPlan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

    const addonVerified  = Boolean((ctx.venue as Record<string, unknown>).directory_addon_verified);
    const addonSponsored = Boolean((ctx.venue as Record<string, unknown>).directory_addon_sponsored);
    const addonConcierge = Boolean((ctx.venue as Record<string, unknown>).directory_addon_concierge);

    const charge = computeMonthlyTotalCents({
      plan: targetPlan, allPlans,
      addonVerifiedUser: addonVerified, addonSponsoredUser: addonSponsored, addonConciergeUser: addonConcierge,
      prices: addonPrices,
    });
    if (charge.total_cents <= 0) {
      return NextResponse.json({ error: 'Plan total is $0 — no card needed.' }, { status: 400 });
    }

    // ── Find or create LP customer ───────────────────────────────────────────
    const venueEmail = String((ctx.venue as Record<string, unknown>).email ?? '');
    const venueName  = String((ctx.venue as Record<string, unknown>).name ?? '');
    let customerId: number = Number((ctx.venue as Record<string, unknown>).platform_lunarpay_customer_id ?? 0);

    if (!customerId && venueEmail) {
      try {
        const res = await listCustomers(secret, venueEmail);
        const list: Record<string, unknown>[] = Array.isArray(res)
          ? res
          : ((res as Record<string, unknown>).data as Record<string, unknown>[] ?? []);
        const match = list.find((c) => c.email === venueEmail);
        if (match?.id) customerId = Number(match.id);
      } catch { /* create below */ }
    }

    if (!customerId) {
      const parts = venueName.trim().split(' ');
      const cr = await createCustomer(secret, {
        firstName: parts[0] || venueName,
        lastName:  parts.slice(1).join(' ') || '',
        email:     venueEmail,
      });
      const created = (cr as Record<string, unknown>).data || cr;
      customerId = Number((created as Record<string, unknown>).id);
    }

    if (!customerId) {
      return NextResponse.json({ error: 'Could not create payment customer. Please contact support.' }, { status: 500 });
    }

    // ── Save vaulted card as a payment method ────────────────────────────────
    const pmResult = await savePaymentMethodFromVault(secret, customerId, vaultId, paymentMethod);
    const pm = (pmResult as Record<string, unknown>).data || pmResult;
    const paymentMethodId = Number((pm as Record<string, unknown>).id);

    if (!paymentMethodId) {
      return NextResponse.json({ error: 'Could not save payment method. Please try again.' }, { status: 500 });
    }

    // ── Create LP subscription starting on trial end date ────────────────────
    const startOnIso = trialEndsAt.length === 10
      ? `${trialEndsAt}T12:00:00.000Z`
      : trialEndsAt;

    const subPayload: Record<string, unknown> = {
      customerId:      customerId,
      paymentMethodId: paymentMethodId,
      amount:          charge.total_cents,
      frequency:       'monthly',
      startOn:         startOnIso,
      description:     `StoryVenue — ${targetPlan.name} (14-day trial, first charge ${trialEndsAt.slice(0, 10)})`,
    };

    console.log('[signup-confirm] creating subscription:', JSON.stringify(subPayload));
    const subResult = await createSubscription(secret, subPayload);
    const sub = (subResult as Record<string, unknown>).data || subResult;
    const newSubId = String((sub as Record<string, unknown>).id ?? '');

    if (!newSubId) {
      return NextResponse.json({ error: 'Subscription could not be created. Please contact support.' }, { status: 500 });
    }

    console.log('[signup-confirm] subscription created:', newSubId);

    // ── Persist to venue row ─────────────────────────────────────────────────
    await supabaseAdmin
      .from('venues')
      .update({
        directory_subscription_status:      'trialing',
        directory_subscription_external_id: newSubId,
        platform_lunarpay_customer_id:      String(customerId),
        directory_trial_started_at:         trialStartedAt,
        directory_trial_ends_at:            trialEndsAt,
        directory_trial_is_forever:         false,
        directory_trial_plan_id:            planId,
        directory_trial_consumed:           true,
        directory_addon_verified:           addonVerified,
        directory_addon_sponsored:          addonSponsored,
        directory_addon_concierge:          addonConcierge,
      })
      .eq('id', venueId);

    // ── Audit log ────────────────────────────────────────────────────────────
    await supabaseAdmin.from('platform_billing_events').insert({
      venue_id:          venueId,
      directory_plan_id: planId,
      amount_cents:      0,
      currency:          'usd',
      external_event_id: `signup_confirm:${venueId}:${newSubId}`,
      event_type:        'subscription_signup_trial_start',
      metadata: {
        new_subscription_id: newSubId,
        customer_id:         String(customerId),
        payment_method_id:   String(paymentMethodId),
        trial_ends_at:       trialEndsAt,
        monthly_cents:       charge.total_cents,
        flow:                'inline_elements',
        payment_method:      paymentMethod,
      },
    });

    return NextResponse.json({ ok: true, subscription_id: newSubId, trial_ends_at: trialEndsAt });
  } catch (err) {
    console.error('[signup-confirm] UNCAUGHT:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected error. Please contact support.' },
      { status: 500 },
    );
  }
}
