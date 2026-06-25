import { NextResponse } from 'next/server';
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
 * The card-gated Bride Booking System conversion funnel: signup → onboarding →
 * card → publish → activate → paid. Authoritative counts come from venue STATE
 * (so non-returners are still counted correctly), with the in-modal micro-steps
 * (details written, card shown) sourced from analytics events. Returns ordered
 * stages with absolute counts, % of signups, and step-to-step conversion so you
 * can see exactly where venues fall off.
 */
export async function GET() {
  if (!(await verifyDashboardRead())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Authoritative venue lifecycle state (exclude demos).
  const { data: venues } = await supabaseAdmin
    .from('venues')
    .select(
      'id, is_demo, is_published, onboarding_last_step, onboarding_completed_at, onboarding_activated_at, directory_subscription_status, directory_subscription_external_id, directory_trial_consumed',
    );

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

  const ENTERED = new Set(['trialing', 'active', 'past_due', 'canceled']);

  let signedUp = 0;
  let startedOnboarding = 0;
  let detailsDone = 0;
  let cardShown = 0;
  let cardEntered = 0;
  let published = 0;
  let activated = 0;
  let paid = 0;

  for (const vv of real) {
    const v = vv as Record<string, unknown>;
    const id = String(v.id);
    const step = typeof v.onboarding_last_step === 'number' ? (v.onboarding_last_step as number) : null;
    const status = String(v.directory_subscription_status ?? '').toLowerCase();
    const hasSub = Boolean(v.directory_subscription_external_id) || ENTERED.has(status);

    signedUp += 1;

    if (evSets.onboarding_started.has(id) || step !== null || v.is_published || v.onboarding_completed_at) startedOnboarding += 1;
    if (evSets.onboarding_details_done.has(id) || (step !== null && step >= 1) || v.is_published || hasSub) detailsDone += 1;
    if (evSets.card_shown.has(id) || hasSub) cardShown += 1;
    if (evSets.card_entered.has(id) || hasSub) cardEntered += 1;
    if (v.is_published) published += 1;
    if (v.onboarding_activated_at) activated += 1;
    if (status === 'active') paid += 1;
  }

  const stages = [
    { key: 'signed_up', label: 'Signed up', count: signedUp },
    { key: 'started', label: 'Started onboarding', count: startedOnboarding },
    { key: 'details', label: 'Wrote their guide', count: detailsDone },
    { key: 'card_shown', label: 'Saw the card step', count: cardShown },
    { key: 'card_entered', label: 'Entered a card', count: cardEntered },
    { key: 'published', label: 'Published & live', count: published },
    { key: 'activated', label: 'Saw a lead land', count: activated },
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
