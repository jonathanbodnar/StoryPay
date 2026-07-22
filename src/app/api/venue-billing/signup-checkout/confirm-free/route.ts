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
  savePaymentMethod,
  splitCustomerName,
} from '@/lib/lunarpay';
import { resolveFreePlan } from '@/lib/trial-plans';
import { trackEvent } from '@/lib/analytics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/venue-billing/signup-checkout/confirm-free
 * Body: { ticketId: string; paymentMethod?: string }
 *
 * Free-plan sibling of signup-checkout/confirm. Vaults the card for
 * verification (the card requirement stays mandatory) but creates NO LunarPay
 * subscription and schedules NO charge. The venue lands on the $0 Free plan.
 *
 * IMPORTANT: this deliberately duplicates the vault logic from the paid confirm
 * route rather than sharing it, so the proven paid trial path stays untouched.
 * The only LunarPay calls made here are find/create customer + savePaymentMethod
 * (a $0.01 auth + instant refund per LP docs). createSubscription is never called.
 */
export async function POST(req: NextRequest) {
  try {
    const c = await cookies();
    const venueId = c.get('venue_id')?.value;
    if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { ticketId?: string; paymentMethod?: string };
    const { ticketId, paymentMethod = 'cc' } = body;
    if (!ticketId) return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });

    const ctx = await loadVenueDirectoryPlanContext(venueId);
    if (!ctx) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    const venue = ctx.venue as Record<string, unknown>;

    // ── Idempotency ──────────────────────────────────────────────────────────
    // Already carded (paid trial OR a prior free-confirm) → nothing to do.
    if (
      venue.directory_card_on_file === true ||
      (venue.directory_subscription_external_id &&
        ['trialing', 'active', 'past_due'].includes(String(venue.directory_subscription_status ?? '')))
    ) {
      return NextResponse.json({ ok: true, already_processed: true });
    }

    let secret: string;
    try {
      secret = requirePlatformLunarPaySecretKey();
    } catch {
      return NextResponse.json({ error: 'Payment system not configured.' }, { status: 503 });
    }

    // ── Find or create LP customer ───────────────────────────────────────────
    const venueEmail = String(venue.email ?? '');
    const venueName = String(venue.name ?? '');
    let customerId: number = Number(venue.platform_lunarpay_customer_id ?? 0);

    if (!customerId && venueEmail) {
      try {
        const res = await listCustomers(secret, venueEmail);
        const list: Record<string, unknown>[] = Array.isArray(res)
          ? res
          : ((res as Record<string, unknown>).data as Record<string, unknown>[] ?? []);
        const match = list.find((x) => x.email === venueEmail);
        if (match?.id) customerId = Number(match.id);
      } catch { /* create below */ }
    }

    if (!customerId) {
      const { firstName, lastName } = splitCustomerName(venueName, venueEmail);
      const cr = await createCustomer(secret, { firstName, lastName, email: venueEmail });
      const created = (cr as Record<string, unknown>).data || cr;
      customerId = Number((created as Record<string, unknown>).id);
    }

    if (!customerId) {
      return NextResponse.json({ error: 'Could not create payment customer. Please contact support.' }, { status: 500 });
    }

    // ── Save card via ticketId → paymentMethodId (NO subscription created) ────
    const pmResult = await savePaymentMethod(
      secret, customerId, ticketId, venueName,
      { paymentMethod, setDefault: true },
    );
    const pm = (pmResult as Record<string, unknown>).data || pmResult;
    const paymentMethodId = Number(
      ((pm as Record<string, unknown>).payment_method as Record<string, unknown> | undefined)?.id ??
      (pm as Record<string, unknown>).id,
    );

    if (!paymentMethodId || Number.isNaN(paymentMethodId)) {
      return NextResponse.json({ error: 'Could not save payment method. Please try again.' }, { status: 500 });
    }

    // ── Land the venue on the $0 Free plan (no subscription, no charge) ───────
    const freePlan = await resolveFreePlan();

    const venueUpdate: Record<string, unknown> = {
      platform_lunarpay_customer_id: String(customerId),
      directory_card_on_file: true,
      // No subscription: clear any external ref, no trial, free forever.
      directory_subscription_status: 'none',
      directory_subscription_external_id: null,
      directory_trial_started_at: null,
      directory_trial_ends_at: null,
      directory_trial_is_forever: true,
      directory_trial_consumed: true,
      directory_downgrade_at: null,
      ...(freePlan ? { directory_plan_id: freePlan.id } : {}),
    };

    let persisted = false;
    let persistError: string | null = null;
    for (let attempt = 0; attempt < 3 && !persisted; attempt++) {
      const { error: upErr } = await supabaseAdmin.from('venues').update(venueUpdate).eq('id', venueId);
      if (!upErr) { persisted = true; break; }
      persistError = upErr.message;
      // Tolerate pre-migration schemas missing directory_card_on_file.
      if (/directory_card_on_file/.test(upErr.message)) {
        const { directory_card_on_file: _omit, ...withoutFlag } = venueUpdate;
        void _omit;
        const retry = await supabaseAdmin.from('venues').update(withoutFlag).eq('id', venueId);
        if (!retry.error) { persisted = true; break; }
        persistError = retry.error.message;
      }
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }

    // ── Stop the dormant re-engagement drip (Free onboarders get no nudges) ───
    try {
      const { cancelReengagementDrip } = await import('@/lib/reengagement-drip');
      await cancelReengagementDrip(venueId, 'converted');
    } catch { /* non-fatal */ }

    // ── Audit log ─────────────────────────────────────────────────────────────
    await supabaseAdmin.from('platform_billing_events').insert({
      venue_id:          venueId,
      directory_plan_id: freePlan?.id ?? null,
      amount_cents:      0,
      currency:          'usd',
      external_event_id: `signup_confirm_free:${venueId}:${customerId}`,
      event_type:        'signup_card_vaulted_free',
      metadata: {
        customer_id:         String(customerId),
        payment_method_id:   String(paymentMethodId),
        ticket_id:           ticketId,
        flow:                'inline_elements_free',
        payment_method:      paymentMethod,
        free_plan_id:        freePlan?.id ?? null,
        venue_row_persisted: persisted,
      },
    }).then(({ error }) => { if (error) console.warn('[signup-confirm-free] audit log:', error.message); });

    if (persisted) {
      await trackEvent({
        event: 'card_on_file', kind: 'milestone', venueId, role: 'owner',
        label: 'Card vaulted on Free plan (no subscription)',
        properties: { customerId: String(customerId), plan: 'free' },
      });
    } else {
      console.error('[signup-confirm-free] venue row update FAILED after retries:', persistError, { venueId });
    }

    return NextResponse.json({ ok: true, persisted, plan: 'free' });
  } catch (err) {
    console.error('[signup-confirm-free] UNCAUGHT:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected error. Please contact support.' },
      { status: 500 },
    );
  }
}
