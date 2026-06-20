import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminIdentity } from '@/lib/admin-identity';

/**
 * Master super admin OR any team member with `dashboard` tab access may read
 * the platform stats. (Older versions required the master admin_token; that
 * locked out invited team members and made the dashboard fail silently.)
 */
async function verifyDashboardRead(): Promise<boolean> {
  const id = await getAdminIdentity();
  if (id.isMasterSuperAdmin) return true;
  return id.allowedTabs.has('dashboard');
}

export async function GET(request: NextRequest) {
  if (!(await verifyDashboardRead())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const from = searchParams.get('from');
  const to   = searchParams.get('to');
  const toEnd = to ? to + 'T23:59:59.999Z' : undefined;

  // All proposals in range
  let q = supabaseAdmin.from('proposals').select('status, price, created_at, paid_at, customer_email, venue_id');
  if (from)   q = q.gte('created_at', from);
  if (toEnd)  q = q.lte('created_at', toEnd);
  const { data: proposals } = await q;
  const rows = proposals ?? [];

  const totalRevenue = rows.filter(r => r.status === 'paid').reduce((s, r) => s + (r.price ?? 0), 0);
  const totalProposals = rows.length;
  const pendingPayments = rows.filter(r => r.status === 'sent' || r.status === 'opened').length;
  const failedPayments  = rows.filter(r => r.status === 'failed' || r.status === 'declined').length;
  const uniqueCustomers = new Set(rows.map(r => r.customer_email).filter(Boolean)).size;
  const uniqueVenues    = new Set(rows.map(r => r.venue_id).filter(Boolean)).size;

  const statusBreakdown: Record<string, number> = {};
  for (const r of rows) {
    const s = r.status || 'unknown';
    statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
  }

  // Waitlist count
  const { count: waitlistCount } = await supabaseAdmin.from('waitlist').select('*', { count: 'exact', head: true });

  // Venue count
  const { count: venueCount } = await supabaseAdmin.from('venues').select('*', { count: 'exact', head: true });

  // Monthly chart
  const now = new Date();
  const rangeStart = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const rangeEnd   = to   ? new Date(to)   : now;
  const monthlyData: Record<string, { revenue: number; proposals: number }> = {};
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  while (cursor <= rangeEnd) {
    const key = cursor.toISOString().slice(0, 7);
    monthlyData[key] = { revenue: 0, proposals: 0 };
    cursor.setMonth(cursor.getMonth() + 1);
  }
  for (const p of rows) {
    const month = (p.paid_at || p.created_at)?.slice(0, 7);
    if (month && monthlyData[month]) {
      monthlyData[month].proposals++;
      if (p.status === 'paid') monthlyData[month].revenue += p.price || 0;
    }
  }
  const monthlyChart = Object.entries(monthlyData).map(([month, d]) => ({
    month,
    label: new Date(month + '-15').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    revenue: d.revenue,
    proposals: d.proposals,
  }));

  // ── StoryVenue directory SaaS: MRR from plan assignments + cash from platform_billing_events ──
  // Only venues with status='active' (real paid subscription) count toward MRR.
  // Trialing venues are on a free trial — they have not paid and must not inflate MRR.
  const ACTIVE_SUB = new Set(['active']);
  // "Assigned MRR" = venues with a priced plan + status active or past_due (past_due still owes the bill).
  const EXCLUDE_FROM_ASSIGNED_MRR = new Set(['canceled', 'trialing', 'none', 'pending', '']);

  let directoryActiveMrrCents = 0;
  let directoryAssignedMrrCents = 0;
  let directoryActiveSubscriptionCount = 0;
  let directoryAssignedPayingVenueCount = 0;
  const directoryPlanAgg = new Map<
    string,
    { name: string; slug: string; venueCount: number; mrrCents: number }
  >();

  const { data: directoryVenues, error: directoryVenuesErr } = await supabaseAdmin
    .from('venues')
    .select('id, directory_plan_id, directory_subscription_status, directory_trial_ends_at, directory_trial_consumed, last_login_at, is_demo')
    .not('directory_plan_id', 'is', null);

  if (directoryVenuesErr) {
    console.warn('[admin/stats] directory SaaS venues query:', directoryVenuesErr.message);
  }

  const dPlanIds = [
    ...new Set((directoryVenues ?? []).map((v) => v.directory_plan_id).filter(Boolean)),
  ] as string[];
  const planById = new Map<
    string,
    { id: string; name: string; slug: string; price_monthly_cents: number | null }
  >();
  if (dPlanIds.length > 0) {
    const { data: dPlans } = await supabaseAdmin
      .from('directory_plans')
      .select('id, name, slug, price_monthly_cents')
      .in('id', dPlanIds);
    for (const p of dPlans ?? []) planById.set(p.id, p);
  }

  for (const row of directoryVenues ?? []) {
    const planId = row.directory_plan_id as string | null;
    if (!planId) continue;
    const plan = planById.get(planId);
    if (!plan) continue;
    const price = plan.price_monthly_cents ?? 0;
    if (price <= 0) continue;

    const st = (row.directory_subscription_status as string | undefined) ?? 'none';

    if (!EXCLUDE_FROM_ASSIGNED_MRR.has(st)) {
      directoryAssignedMrrCents += price;
      directoryAssignedPayingVenueCount++;
      const agg = directoryPlanAgg.get(plan.id) ?? {
        name: plan.name,
        slug: plan.slug,
        venueCount: 0,
        mrrCents: 0,
      };
      agg.venueCount += 1;
      agg.mrrCents += price;
      directoryPlanAgg.set(plan.id, agg);
    }

    if (ACTIVE_SUB.has(st)) {
      directoryActiveMrrCents += price;
      directoryActiveSubscriptionCount += 1;
    }
  }

  const directoryMrrByPlan = [...directoryPlanAgg.entries()].map(([planId, v]) => ({
    planId,
    name: v.name,
    slug: v.slug,
    venueCount: v.venueCount,
    mrrCents: v.mrrCents,
  }));

  // ── Trial funnel: per-venue breakdown of where signups end up ──────────────
  // Definitions:
  //   activeTrialing  — trial period still running (trial_ends_at > now)
  //   expiredNoAction — trial ended but still on 'trialing' status (never upgraded/downgraded)
  //   upgraded        — moved to status='active' (paid) after trial was consumed
  //   downgraded      — trial was consumed but status ended up canceled/none/pending (chose free)
  //   neverLoggedIn   — trial expired and last_login_at is null (signed up, never came back)
  // Only non-demo venues are counted.
  const PLAN_PRICE_CENTS = 9700; // $97/mo — Venue Pro
  const now_iso = new Date().toISOString();

  let trialFunnel = {
    totalSignups:       0,
    activeTrialing:     0,
    expiredNoAction:    0,
    upgraded:           0,
    downgraded:         0,
    neverLoggedIn:      0,
  };

  for (const row of directoryVenues ?? []) {
    if ((row as Record<string, unknown>).is_demo) continue;
    trialFunnel.totalSignups++;
    const st         = ((row as Record<string, unknown>).directory_subscription_status as string) ?? 'none';
    const trialEnds  = (row as Record<string, unknown>).directory_trial_ends_at as string | null;
    const consumed   = Boolean((row as Record<string, unknown>).directory_trial_consumed);
    const lastLogin  = (row as Record<string, unknown>).last_login_at as string | null;
    const trialActive = trialEnds ? trialEnds > now_iso : false;

    if (st === 'active') {
      trialFunnel.upgraded++;
    } else if (st === 'trialing') {
      if (trialActive) {
        trialFunnel.activeTrialing++;
      } else {
        // Trial period is over but they're still on trialing — took no action.
        trialFunnel.expiredNoAction++;
        // Count never-logged-in separately (signed up but ghosted).
        if (!lastLogin) trialFunnel.neverLoggedIn++;
      }
    } else if (consumed && (st === 'canceled' || st === 'none' || st === 'pending' || st === '')) {
      // They went through the trial and chose not to pay.
      trialFunnel.downgraded++;
    }
  }

  let platformSaaSRevenueInRangeCents = 0;
  const saasMonthly: Record<string, number> = {};
  const saasCursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  while (saasCursor <= rangeEnd) {
    const key = saasCursor.toISOString().slice(0, 7);
    saasMonthly[key] = 0;
    saasCursor.setMonth(saasCursor.getMonth() + 1);
  }

  let peq = supabaseAdmin.from('platform_billing_events').select('amount_cents, occurred_at');
  if (from) peq = peq.gte('occurred_at', from);
  if (toEnd) peq = peq.lte('occurred_at', toEnd);
  const { data: platformEvents, error: platformEventsErr } = await peq;

  if (!platformEventsErr && platformEvents) {
    for (const e of platformEvents) {
      const amt = e.amount_cents ?? 0;
      platformSaaSRevenueInRangeCents += amt;
      const month = e.occurred_at?.slice(0, 7);
      if (month && Object.prototype.hasOwnProperty.call(saasMonthly, month)) {
        saasMonthly[month] += amt;
      }
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
  {
    const { data, error } = await supabaseAdmin
      .from('feature_requests')
      .select('id, title, vote_count, status, created_at, admin_read_at, category, venue_id')
      .order('created_at', { ascending: false });
    if (error && /admin_read_at|category/i.test(error.message)) {
      // Pre-migration fallback
      const { data: plain } = await supabaseAdmin
        .from('feature_requests')
        .select('id, title, vote_count, status, created_at, venue_id')
        .order('created_at', { ascending: false });
      featureRequests = (plain ?? []).map(r => ({ ...r, admin_read_at: null, category: 'feature_request' }));
    } else {
      featureRequests = (data ?? []).map(r => ({
        ...r,
        admin_read_at: (r as Record<string, unknown>).admin_read_at as string | null ?? null,
        category: (r as Record<string, unknown>).category as string ?? 'feature_request',
        venue_id: (r as Record<string, unknown>).venue_id as string | null ?? null,
      }));
    }
  }

  return NextResponse.json({
    totalRevenue,
    totalProposals,
    pendingPayments,
    failedPayments,
    uniqueCustomers,
    uniqueVenues,
    waitlistCount: waitlistCount ?? 0,
    venueCount: venueCount ?? 0,
    statusBreakdown,
    monthlyChart,
    featureRequests: featureRequests ?? [],
    directoryActiveMrrCents,
    directoryAssignedMrrCents,
    directoryActiveSubscriptionCount,
    directoryAssignedPayingVenueCount,
    directoryMrrByPlan,
    platformSaaSRevenueInRangeCents,
    platformSaaSMonthlyChart,
    trialFunnel,
    trialPlanPriceCents: PLAN_PRICE_CENTS,
  });
}
