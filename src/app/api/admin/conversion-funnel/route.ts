import { NextRequest, NextResponse } from 'next/server';
import { getAdminIdentity } from '@/lib/admin-identity';
import { loadFunnelData } from '@/lib/funnel-data';
import { FUNNEL_STAGES, venueStageReached, type FunnelStageKey } from '@/lib/funnel-stage';

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

  const { venues, evSets } = await loadFunnelData(from, to);

  // Per-stage counts via the shared stage logic (single source of truth).
  const counts: Record<FunnelStageKey, number> = {
    signed_up: 0, started: 0, details: 0, activated: 0, card_shown: 0, card_entered: 0, paid: 0,
  };
  for (const v of venues) {
    const reached = venueStageReached(v, evSets);
    for (const s of FUNNEL_STAGES) if (reached[s.key]) counts[s.key] += 1;
  }

  const stages = FUNNEL_STAGES.map((s) => ({ key: s.key, label: s.label, count: counts[s.key] }));
  const signedUp = counts.signed_up;
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
