/**
 * The super admin dashboard's numbers (/api/admin/stats). Kept here so they
 * can be checked outside a request.
 *
 * The demo venue is test data and is left out of every number.
 */
import { supabaseAdmin } from '@/lib/supabase';
import {
  loadLiveSaasSubscriptions,
  recordUnseenLunarPayCharges,
  saasSubscriptionRef,
  type SaasBillingVenue,
} from '@/lib/saas-billing-live';

/** Proposal statuses still waiting on the couple to pay (matches /api/admin/payments?status=pending). */
const AWAITING_PAYMENT = ['sent', 'opened', 'signed', 'partially_paid'];

/**
 * Where a venue stands with its StoryVenue subscription. Every non-demo venue
 * lands in exactly one, so the breakdown adds up to the venue total.
 */
type SubBucket = 'paying' | 'pastDue' | 'trialActive' | 'trialEnded' | 'free' | 'canceled' | 'legacy';

/** `from` / `to` are YYYY-MM-DD (the dashboard's date range); null means open-ended. */
export async function loadAdminDashboardStats(from: string | null, to: string | null) {
  const toEnd = to ? to + 'T23:59:59.999Z' : undefined;

  // The demo venue is test data: it's left out of every platform number.
  const [{ data: venuesRaw }, { data: plansRaw }] = await Promise.all([
    supabaseAdmin
      .from('venues')
      .select('id, name, email, ghl_location_id, setup_completed, created_at, last_login_at, is_demo, is_suspended, directory_plan_id, directory_subscription_status, directory_subscription_external_id, directory_trial_ends_at, billing_provider, stripe_subscription_id'),
    supabaseAdmin.from('directory_plans').select('id, name, slug, price_monthly_cents, is_legacy'),
  ]);
  const venues = (venuesRaw ?? []).filter((v) => !v.is_demo);
  const demoIds = (venuesRaw ?? []).filter((v) => v.is_demo).map((v) => v.id as string);
  // Filter child rows to real venues by leaving the demo out (a short list, unlike every real venue id).
  const notDemo = demoIds.length ? `(${demoIds.join(',')})` : '(00000000-0000-0000-0000-000000000000)';
  const planById = new Map((plansRaw ?? []).map((p) => [p.id as string, p]));

  // ── StoryPay™ (couple payments) ──────────────────────────────────────────
  let q = supabaseAdmin.from('proposals').select('id, status, price, created_at, paid_at, customer_email, venue_id').not('venue_id', 'in', notDemo);
  if (from)   q = q.gte('created_at', from);
  if (toEnd)  q = q.lte('created_at', toEnd);
  let lq = supabaseAdmin.from('proposal_payments').select('amount_cents, paid_at').eq('source', 'online').not('venue_id', 'in', notDemo);
  if (from)   lq = lq.gte('paid_at', from);
  if (toEnd)  lq = lq.lte('paid_at', toEnd);
  let fq = supabaseAdmin.from('proposal_installments').select('proposal_id').eq('status', 'failed').not('venue_id', 'in', notDemo);
  if (from)   fq = fq.gte('updated_at', from);
  if (toEnd)  fq = fq.lte('updated_at', toEnd);

  const [
    { data: proposals },
    { data: onlinePayments },
    { data: failedInstallments },
    { count: waitlistCount },
    { count: totalContacts },
    { data: frData, error: frError },
  ] = await Promise.all([
    q,
    lq,
    fq,
    supabaseAdmin.from('waitlist').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('venue_customers').select('id', { count: 'exact', head: true }).not('venue_id', 'in', notDemo),
    supabaseAdmin
      .from('feature_requests')
      .select('id, title, vote_count, status, created_at, admin_read_at, category, venue_id')
      .order('created_at', { ascending: false }),
  ]);
  const rows = proposals ?? [];

  // Money couples actually paid online through StoryPay™ (the payments ledger;
  // an installment plan counts as each payment lands, not at its full price).
  const totalRevenue = (onlinePayments ?? []).reduce((s, p) => s + (p.amount_cents ?? 0), 0);
  const totalProposals = rows.length;
  const pendingPayments = rows.filter((r) => AWAITING_PAYMENT.includes(r.status)).length;
  // Same rules as the Failed payments list (/api/admin/payments?status=failed).
  const failedProposalIds = new Set<string>((failedInstallments ?? []).map((i) => i.proposal_id as string));
  for (const r of rows) if (r.status === 'failed' || r.status === 'declined') failedProposalIds.add(r.id as string);
  const failedPayments = failedProposalIds.size;
  const uniqueCustomers = new Set(rows.map((r) => r.customer_email).filter(Boolean)).size;
  const uniqueVenues    = new Set(rows.map((r) => r.venue_id).filter(Boolean)).size;
  const venueCount = venues.filter((v) => !v.is_suspended).length;

  const statusBreakdown: Record<string, number> = {};
  for (const r of rows) {
    const s = r.status || 'unknown';
    statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
  }

  // Monthly chart: online payments by the month they landed, proposals by the month they were created.
  const now = new Date();
  const rangeStart = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const rangeEnd   = to   ? new Date(to)   : now;
  const monthlyData: Record<string, { revenue: number; proposals: number }> = {};
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  while (cursor <= rangeEnd) {
    monthlyData[cursor.toISOString().slice(0, 7)] = { revenue: 0, proposals: 0 };
    cursor.setMonth(cursor.getMonth() + 1);
  }
  for (const p of rows) {
    const month = p.created_at?.slice(0, 7);
    if (month && monthlyData[month]) monthlyData[month].proposals++;
  }
  for (const pay of onlinePayments ?? []) {
    const month = pay.paid_at?.slice(0, 7);
    if (month && monthlyData[month]) monthlyData[month].revenue += pay.amount_cents ?? 0;
  }
  const monthlyChart = Object.entries(monthlyData).map(([month, d]) => ({
    month,
    label: new Date(month + '-15').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    revenue: d.revenue,
    proposals: d.proposals,
  }));

  // ── StoryVenue subscriptions (SaaS) ──────────────────────────────────────
  // Stripe webhooks keep each venue's status current; what each venue is
  // actually billed is read live from Stripe and LunarPay (lib/saas-billing-live).
  const billingVenues: SaasBillingVenue[] = venues.map((v) => ({
    id: v.id as string,
    billing_provider: (v.billing_provider as string | null) ?? null,
    stripe_subscription_id: (v.stripe_subscription_id as string | null) ?? null,
    directory_subscription_external_id: (v.directory_subscription_external_id as string | null) ?? null,
    directory_plan_id: (v.directory_plan_id as string | null) ?? null,
  }));
  const billingById = new Map(billingVenues.map((b) => [b.id, b]));
  const { subs: liveSubs, warnings: saasLiveWarnings } = await loadLiveSaasSubscriptions(billingVenues);
  await recordUnseenLunarPayCharges(billingVenues, liveSubs).catch((e) =>
    console.warn('[admin/stats] LunarPay charge sync failed:', e instanceof Error ? e.message : e),
  );

  const paidPlanPriceCents =
    (plansRaw ?? []).find((p) => p.slug === 'bride-booking-system')?.price_monthly_cents ?? 9700;
  const nowIso = now.toISOString();
  type VenueInfo = { id: string; name: string; email: string; ghl_location_id: string; setup_completed: boolean; created_at: string };
  const breakdown: Record<SubBucket | 'neverLoggedIn', { count: number; venues: VenueInfo[] }> = {
    paying: { count: 0, venues: [] },
    pastDue: { count: 0, venues: [] },
    trialActive: { count: 0, venues: [] },
    trialEnded: { count: 0, venues: [] },
    neverLoggedIn: { count: 0, venues: [] },
    free: { count: 0, venues: [] },
    canceled: { count: 0, venues: [] },
    legacy: { count: 0, venues: [] },
  };
  const payingByProvider = { stripe: 0, lunarpay: 0 };
  let activeMrrCents = 0;
  let scheduledMrrCents = 0;
  let scheduledVenueCount = 0;
  let pastDueCents = 0;
  const mrrByPlan = new Map<string, { name: string; slug: string; venueCount: number; mrrCents: number }>();

  for (const v of venues) {
    const plan = v.directory_plan_id ? planById.get(v.directory_plan_id as string) : undefined;
    const st = (v.directory_subscription_status as string | null) ?? 'none';
    const ref = saasSubscriptionRef(billingById.get(v.id as string)!);
    const live = liveSubs.get(v.id as string);
    const amount = live?.amountCents ?? plan?.price_monthly_cents ?? 0;
    const trialRunning = Boolean(v.directory_trial_ends_at && (v.directory_trial_ends_at as string) > nowIso);

    let bucket: SubBucket;
    if (plan?.is_legacy) bucket = 'legacy';
    else if (st === 'active') {
      // LunarPay can stop charging without telling the app: trust its live status.
      bucket = live?.provider === 'lunarpay' && live.status !== 'active' ? 'pastDue' : 'paying';
    } else if (st === 'past_due' || st === 'unpaid') bucket = 'pastDue';
    else if (st === 'trialing') bucket = trialRunning ? 'trialActive' : 'trialEnded';
    else if (plan && (plan.price_monthly_cents ?? 0) === 0) bucket = 'free';
    else bucket = 'canceled';

    const info: VenueInfo = {
      id: v.id as string,
      name: (v.name as string) || 'Unnamed Venue',
      email: (v.email as string) || '',
      ghl_location_id: (v.ghl_location_id as string) || '',
      setup_completed: Boolean(v.setup_completed),
      created_at: (v.created_at as string) || nowIso,
    };
    breakdown[bucket].count++;
    breakdown[bucket].venues.push(info);

    if (bucket === 'paying') {
      activeMrrCents += amount;
      payingByProvider[ref?.provider === 'stripe' ? 'stripe' : 'lunarpay']++;
      if (plan) {
        const agg = mrrByPlan.get(plan.id as string) ?? { name: plan.name as string, slug: plan.slug as string, venueCount: 0, mrrCents: 0 };
        agg.venueCount++;
        agg.mrrCents += amount;
        mrrByPlan.set(plan.id as string, agg);
      }
    } else if (bucket === 'pastDue') {
      pastDueCents += amount;
    } else if (bucket === 'trialActive' && ref) {
      // Card on file: the first charge fires when the trial ends.
      scheduledMrrCents += amount;
      scheduledVenueCount++;
    } else if (bucket === 'trialEnded' && !v.last_login_at) {
      breakdown.neverLoggedIn.count++;
      breakdown.neverLoggedIn.venues.push(info);
    }
  }

  // SaaS cash: subscription money collected in the range (Stripe records each
  // charge instantly; LunarPay charges were just synced above).
  let peq = supabaseAdmin.from('platform_billing_events').select('amount_cents, occurred_at').or(`venue_id.is.null,venue_id.not.in.${notDemo}`);
  if (from) peq = peq.gte('occurred_at', from);
  if (toEnd) peq = peq.lte('occurred_at', toEnd);
  const { data: platformEvents, error: platformEventsErr } = await peq;

  let platformSaaSRevenueInRangeCents = 0;
  const saasMonthly: Record<string, number> = {};
  const saasCursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  while (saasCursor <= rangeEnd) {
    saasMonthly[saasCursor.toISOString().slice(0, 7)] = 0;
    saasCursor.setMonth(saasCursor.getMonth() + 1);
  }
  if (!platformEventsErr && platformEvents) {
    for (const e of platformEvents) {
      const amt = e.amount_cents ?? 0;
      platformSaaSRevenueInRangeCents += amt;
      const month = e.occurred_at?.slice(0, 7);
      if (month && Object.prototype.hasOwnProperty.call(saasMonthly, month)) saasMonthly[month] += amt;
    }
  }
  const platformSaaSMonthlyChart = Object.entries(saasMonthly).map(([month, revenue]) => ({
    month,
    label: new Date(month + '-15').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    revenue,
  }));

  // Feature requests — all of them (no limit) so the admin tab has the full list.
  // admin_read_at and category are optional columns; fall back gracefully if missing.
  let featureRequests: { id: string; title: string; vote_count: number; status: string; created_at: string; admin_read_at: string | null; category: string; venue_id: string | null }[] = [];
  if (frError && /admin_read_at|category/i.test(frError.message)) {
    // Pre-migration fallback
    const { data: plain } = await supabaseAdmin
      .from('feature_requests')
      .select('id, title, vote_count, status, created_at, venue_id')
      .order('created_at', { ascending: false });
    featureRequests = (plain ?? []).map(r => ({ ...r, admin_read_at: null, category: 'feature_request' }));
  } else {
    featureRequests = (frData ?? []).map(r => ({
      ...r,
      admin_read_at: (r as Record<string, unknown>).admin_read_at as string | null ?? null,
      category: (r as Record<string, unknown>).category as string ?? 'feature_request',
      venue_id: (r as Record<string, unknown>).venue_id as string | null ?? null,
    }));
  }

  return {
    totalRevenue,
    totalProposals,
    pendingPayments,
    failedPayments,
    uniqueCustomers,
    uniqueVenues,
    totalContacts: totalContacts ?? 0,
    waitlistCount: waitlistCount ?? 0,
    venueCount,
    statusBreakdown,
    monthlyChart,
    featureRequests: featureRequests ?? [],
    directoryActiveMrrCents: activeMrrCents,
    directoryScheduledMrrCents: scheduledMrrCents,
    directoryScheduledVenueCount: scheduledVenueCount,
    directoryActiveSubscriptionCount: breakdown.paying.count,
    directoryPayingByProvider: payingByProvider,
    directoryPastDueCount: breakdown.pastDue.count,
    directoryPastDueCents: pastDueCents,
    directoryMrrByPlan: [...mrrByPlan.entries()].map(([planId, v]) => ({ planId, ...v })),
    platformSaaSRevenueInRangeCents,
    platformSaaSMonthlyChart,
    subscriptionBreakdown: { total: { count: venues.length, venues: breakdown.paying.venues.concat(
      breakdown.pastDue.venues, breakdown.trialActive.venues, breakdown.trialEnded.venues,
      breakdown.free.venues, breakdown.canceled.venues, breakdown.legacy.venues,
    ) }, ...breakdown },
    saasLiveWarnings,
    trialPlanPriceCents: paidPlanPriceCents,
  };
}
