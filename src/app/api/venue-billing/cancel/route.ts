import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { scheduleVenueDowngradeToFree } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The reasons the cancel dialog offers (labels as the venue saw them). */
const REASONS: Record<string, string> = {
  too_expensive: 'It costs too much',
  not_enough_leads: 'Not getting enough leads or bookings',
  missing_feature: 'Missing something I need',
  hard_to_use: 'Too hard to use',
  switching: 'Switching to another tool',
  closing: 'Closing or pausing my venue',
  other: 'Something else',
};

/**
 * POST /api/venue-billing/cancel   { reason?, note? }
 *
 * The venue cancels its paid plan. No future charge fires, the plan stays on
 * until the end of the term they paid for (or their trial), then they move to
 * the Free plan and stay on the platform (lib/venue-billing.ts). The optional
 * reason is saved with the cancellation and posted to the team's Slack.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { reason?: unknown; note?: unknown };
  const reasonKey = typeof body.reason === 'string' && REASONS[body.reason] ? body.reason : null;
  const reason = reasonKey ? REASONS[reasonKey] : null;
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : null;

  try {
    const result = await scheduleVenueDowngradeToFree(user.venueId, { reason, note });
    // Analytics: churn signal — venue cancels its subscription.
    void import('@/lib/analytics')
      .then(({ trackEvent }) => trackEvent({
        event: 'subscription_canceled', kind: 'auto', venueId: user.venueId,
        userEmail: user.memberEmail, role: user.role, label: 'Subscription canceled',
        properties: { type: 'cancel', outcome: result.kind, reason: reasonKey, note },
      }))
      .catch(() => { /* non-fatal */ });
    void import('@/lib/slack-notify')
      .then(({ notifySubscriptionCanceled }) => notifySubscriptionCanceled({
        venueName: user.venueName,
        venueId: user.venueId,
        reason,
        note,
        endsAt: result.kind === 'scheduled' ? result.downgradeAt : null,
      }))
      .catch(() => { /* non-fatal */ });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Cancel failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
