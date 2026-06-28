import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminIdentity } from '@/lib/admin-identity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function verifyDashboardRead(): Promise<boolean> {
  const id = await getAdminIdentity();
  if (id.isMasterSuperAdmin) return true;
  return id.allowedTabs.has('dashboard');
}

/**
 * GET /api/admin/conversion-funnel
 *
 * The card-gated Bride Booking System conversion funnel, in the ACTUAL product
 * order:
 *   signup → started → wrote guide → sent test inquiry (Go live) → saw card →
 *   added a card (page goes live here) → converted to paid.
 *
 * Going live now coincides with adding the card (the page publishes the instant
 * the card succeeds), so there is no separate "published" stage — a standalone
 * is_published count would be dominated by legacy venues that published under
 * the OLD model with no card, which would misrepresent the new funnel.
 *
 * Authoritative counts come from venue STATE (so non-returners still count),
 * with the in-modal micro-steps (details written, card shown) sourced from
 * analytics events. "Added a card" is the real card-on-file signal
 * (directory_subscription_external_id / a real subscription status) and "paid"
 * is a genuinely active subscription — so a venue that merely viewed the form
 * never inflates the conversion count.
 */
export async function GET(req: NextRequest) {
  if (!(await verifyDashboardRead())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Optional date window — counts only venues that SIGNED UP within the range.
  // This lets the funnel "start tracking" from a campaign launch date instead of
  // mixing in every legacy venue.
  const sp = req.nextUrl.searchParams;
  const from = sp.get('from');
  const to = sp.get('to');
  const toEnd = to ? `${to}T23:59:59.999Z` : undefined;

  // Authoritative venue lifecycle state (exclude demos).
  let venuesQuery = supabaseAdmin
    .from('venues')
    .select(
      'id, is_demo, created_at, is_published, onboarding_last_step, onboarding_completed_at, onboarding_activated_at, directory_subscription_status, directory_subscription_external_id, directory_trial_consumed',
    );
  if (from) venuesQuery = venuesQuery.gte('created_at', from);
  if (toEnd) venuesQuery = venuesQuery.lte('created_at', toEnd);
  const { data: venues } = await venuesQuery;

  const real = (venues ?? []).filter((v) => !(v as Record<string, unknown>).is_demo);

  // Distinct-venue sets for the in-modal analytics micro-steps.
  const wantedEvents = ['onboarding_started', 'onboarding_details_done', 'card_shown', 'card_entered'];
  const evSets: Record<string, Set<string>> = Object.fromEntries(wantedEvents.map((e) => [e, new Set<string>()]));
  const { data: evRows } = await supabaseAdmin
    .from('analytics_events')
    .select('event, venue_id')
    .in('event', wantedEvents)
    .not('venue_id', 'is', null);
  for (const r of (evRows ?? []) as { event: string; venue_id: string | null }[]) {
    if (r.venue_id && evSets[r.event]) evSets[r.event].add(r.venue_id);
  }

  // A real card on file = a subscription was actually created (vaulted card),
  // regardless of where it is in its lifecycle. This is the honest "added a
  // card" signal — viewing the form is NOT enough.
  const CARDED = new Set(['trialing', 'active', 'past_due', 'canceled', 'cancelled']);

  let signedUp = 0;
  let startedOnboarding = 0;
  let detailsDone = 0;
  let activated = 0;
  let cardShown = 0;
  let cardEntered = 0;
  let paid = 0;

  for (const vv of real) {
    const v = vv as Record<string, unknown>;
    const id = String(v.id);
    const step = typeof v.onboarding_last_step === 'number' ? (v.onboarding_last_step as number) : null;
    const status = String(v.directory_subscription_status ?? '').toLowerCase();
    // Carded = a real subscription exists (external id) or the status proves a
    // card was vaulted at some point.
    const hasCard = Boolean(v.directory_subscription_external_id) || CARDED.has(status);

    signedUp += 1;

    if (evSets.onboarding_started.has(id) || step !== null || v.is_published || v.onboarding_completed_at) startedOnboarding += 1;
    if (evSets.onboarding_details_done.has(id) || (step !== null && step >= 1) || v.is_published || hasCard) detailsDone += 1;
    // Sent the test inquiry (the "Go live" step) — page is not public yet.
    if (v.onboarding_activated_at) activated += 1;
    // Reached the card step. Carded venues necessarily saw it.
    if (evSets.card_shown.has(id) || hasCard) cardShown += 1;
    // Actually added a card (card on file). NOT inflated by form views.
    if (hasCard) cardEntered += 1;
    // Genuinely paying (past the trial / active subscription).
    if (status === 'active') paid += 1;
  }

  const stages = [
    { key: 'signed_up', label: 'Signed up', count: signedUp },
    { key: 'started', label: 'Started onboarding', count: startedOnboarding },
    { key: 'details', label: 'Wrote their guide', count: detailsDone },
    { key: 'activated', label: 'Sent a test inquiry', count: activated },
    { key: 'card_shown', label: 'Saw the card step', count: cardShown },
    { key: 'card_entered', label: 'Added a card (went live)', count: cardEntered },
    { key: 'paid', label: 'Converted to paid', count: paid },
  ];

  const top = signedUp || 1;
  const funnel = stages.map((s, i) => {
    const prev = i > 0 ? stages[i - 1].count : s.count;
    return {
      ...s,
      pctOfSignups: Math.round((s.count / top) * 100),
      stepConversion: prev > 0 ? Math.round((s.count / prev) * 100) : 0,
      dropFromPrev: i > 0 ? Math.max(0, prev - s.count) : 0,
    };
  });

  return NextResponse.json({ funnel, signedUp });
}
