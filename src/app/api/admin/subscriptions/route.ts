/**
 * GET /api/admin/subscriptions
 *
 * Cross-venue subscription overview for the admin panel:
 *  - Per-plan MRR breakdown (active subscriptions only)
 *  - Status totals (active, past_due, trialing, canceled, none)
 *  - Per-venue rows with current plan, status, MRR contribution, next bill,
 *    last payment, and last billing event
 *
 * Built on top of the existing directory_plans + venues + platform_billing_events
 * tables — no new schema. Uses supabaseAdmin so it sees every venue regardless
 * of RLS.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { loadAddonPrices } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type PlanRow = {
  id: string;
  name: string;
  slug: string;
  price_monthly_cents: number | null;
  is_default: boolean;
};

type VenueRow = {
  id: string;
  name: string;
  email: string | null;
  created_at: string | null;
  directory_plan_id: string | null;
  directory_subscription_status: string | null;
  directory_subscription_external_id: string | null;
  platform_lunarpay_customer_id: string | null;
  directory_addon_verified: boolean | null;
  directory_addon_sponsored: boolean | null;
  directory_addon_concierge: boolean | null;
};

type EventRow = {
  venue_id: string | null;
  amount_cents: number | null;
  event_type: string | null;
  occurred_at: string | null;
};

export async function GET() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Fetch in parallel
  const [plansRes, venuesRes, eventsRes, addonPrices] = await Promise.all([
    supabaseAdmin
      .from('directory_plans')
      .select('id, name, slug, price_monthly_cents, is_default')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('venues')
      .select(
        'id, name, email, created_at, directory_plan_id, directory_subscription_status, directory_subscription_external_id, platform_lunarpay_customer_id, directory_addon_verified, directory_addon_sponsored, directory_addon_concierge',
      )
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('platform_billing_events')
      .select('venue_id, amount_cents, event_type, occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(2000),
    loadAddonPrices(),
  ]);

  const plans = (plansRes.data || []) as PlanRow[];
  const venues = (venuesRes.data || []) as VenueRow[];
  const events = (eventsRes.data || []) as EventRow[];

  const planById = new Map<string, PlanRow>(plans.map((p) => [p.id, p]));

  // Group events per venue so we can show "last payment" and "lifetime spend"
  const venueLastPayment = new Map<string, EventRow>();
  const venueLifetimeCents = new Map<string, number>();
  for (const ev of events) {
    if (!ev.venue_id) continue;
    if ((ev.amount_cents ?? 0) > 0 && !venueLastPayment.has(ev.venue_id)) {
      venueLastPayment.set(ev.venue_id, ev);
    }
    venueLifetimeCents.set(
      ev.venue_id,
      (venueLifetimeCents.get(ev.venue_id) || 0) + (ev.amount_cents ?? 0),
    );
  }

  // Status totals
  const statusTotals: Record<string, number> = {
    active: 0,
    trialing: 0,
    past_due: 0,
    canceled: 0,
    none: 0,
    pending: 0,
  };

  // Per-plan stats
  type PlanStat = {
    plan: PlanRow;
    venueCount: number;
    activeCount: number;
    pastDueCount: number;
    canceledCount: number;
    mrrCents: number;
  };
  const planStats = new Map<string, PlanStat>();
  for (const p of plans) {
    planStats.set(p.id, {
      plan: p,
      venueCount: 0,
      activeCount: 0,
      pastDueCount: 0,
      canceledCount: 0,
      mrrCents: 0,
    });
  }

  // Venue rows enriched with plan + last payment
  const venueRows = venues.map((v) => {
    const status = (v.directory_subscription_status || 'none').trim().toLowerCase() || 'none';
    statusTotals[status] = (statusTotals[status] || 0) + 1;

    const plan = v.directory_plan_id ? planById.get(v.directory_plan_id) || null : null;
    const planCents = plan?.price_monthly_cents ?? 0;
    const isActive = status === 'active' || status === 'trialing';

    // Compute real MRR = plan base + any active addon prices
    const hasVerified  = Boolean(v.directory_addon_verified);
    const hasSponsored = Boolean(v.directory_addon_sponsored);
    const hasConcierge = Boolean(v.directory_addon_concierge);
    const addonCents =
      (hasVerified  ? (addonPrices.verified_cents  ?? 0) : 0) +
      (hasSponsored ? (addonPrices.sponsored_cents ?? 0) : 0) +
      (hasConcierge ? (addonPrices.concierge_cents ?? 0) : 0);
    const totalCents = planCents + addonCents;
    const mrrCents = isActive ? totalCents : 0;

    if (plan) {
      const stat = planStats.get(plan.id);
      if (stat) {
        stat.venueCount += 1;
        if (isActive) {
          stat.activeCount += 1;
          stat.mrrCents += totalCents;
        }
        if (status === 'past_due') stat.pastDueCount += 1;
        if (status === 'canceled') stat.canceledCount += 1;
      }
    }

    const lastEv = venueLastPayment.get(v.id) || null;

    return {
      id: v.id,
      name: v.name,
      email: v.email,
      created_at: v.created_at,
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            slug: plan.slug,
            price_monthly_cents: plan.price_monthly_cents,
          }
        : null,
      status,
      external_subscription_id: v.directory_subscription_external_id,
      lunarpay_customer_id: v.platform_lunarpay_customer_id,
      addons: {
        verified:  hasVerified,
        sponsored: hasSponsored,
        concierge: hasConcierge,
      },
      mrr_cents: mrrCents,
      lifetime_cents: venueLifetimeCents.get(v.id) || 0,
      last_payment: lastEv
        ? { amount_cents: lastEv.amount_cents ?? 0, occurred_at: lastEv.occurred_at, event_type: lastEv.event_type }
        : null,
    };
  });

  // Sort: active first, then past_due, then by MRR desc, then name
  const statusRank: Record<string, number> = {
    active: 0,
    trialing: 1,
    past_due: 2,
    pending: 3,
    canceled: 4,
    none: 5,
  };
  venueRows.sort((a, b) => {
    const sa = statusRank[a.status] ?? 99;
    const sb = statusRank[b.status] ?? 99;
    if (sa !== sb) return sa - sb;
    if (b.mrr_cents !== a.mrr_cents) return b.mrr_cents - a.mrr_cents;
    return a.name.localeCompare(b.name);
  });

  const totalMrrCents = Array.from(planStats.values()).reduce((acc, s) => acc + s.mrrCents, 0);
  const totalActive = statusTotals.active || 0;
  const totalTrialing = statusTotals.trialing || 0;
  const totalPastDue = statusTotals.past_due || 0;
  const totalCanceled = statusTotals.canceled || 0;
  const totalUnsubscribed = (statusTotals.none || 0) + (statusTotals.pending || 0);

  return NextResponse.json({
    summary: {
      total_mrr_cents: totalMrrCents,
      total_arr_cents: totalMrrCents * 12,
      active_count: totalActive,
      trialing_count: totalTrialing,
      past_due_count: totalPastDue,
      canceled_count: totalCanceled,
      unsubscribed_count: totalUnsubscribed,
      venue_count: venues.length,
      paying_count: totalActive + totalTrialing,
    },
    plans: Array.from(planStats.values())
      .sort((a, b) => b.mrrCents - a.mrrCents || a.plan.name.localeCompare(b.plan.name))
      .map((s) => ({
        id: s.plan.id,
        name: s.plan.name,
        slug: s.plan.slug,
        price_monthly_cents: s.plan.price_monthly_cents,
        is_default: s.plan.is_default,
        venue_count: s.venueCount,
        active_count: s.activeCount,
        past_due_count: s.pastDueCount,
        canceled_count: s.canceledCount,
        mrr_cents: s.mrrCents,
      })),
    venues: venueRows,
  });
}
