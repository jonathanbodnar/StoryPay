/**
 * POST /api/listing/ai-concierge/leads/[leadId]/force-send
 *
 * Venue-side force send: immediately runs the AI pipeline for one of
 * the venue's own leads, bypassing quiet hours. The lead must be in
 * ai_active state. Spend-cap, expiry, and DND checks still apply.
 */
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { runAiSendCron } from '@/lib/ai-concierge/send-cron';

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { leadId } = await params;

  // Verify the lead belongs to this venue before touching anything
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, ai_state')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  if (lead.ai_state !== 'ai_active') {
    return NextResponse.json({ error: 'Lead is not in ai_active state.' }, { status: 409 });
  }

  let result;
  try {
    result = await runAiSendCron({
      maxLeads:           1,
      reservationMinutes: 15,
      leadIdFilter:       leadId,
      bypassQuietHours:   true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ ok: false, message: `Server error: ${msg}` }, { status: 500 });
  }

  if (result.killSwitchEngaged) {
    return NextResponse.json({
      ok: false,
      reason: 'kill_switch',
      message: 'AI is globally paused right now. Contact your StoryVenue concierge team.',
    }, { status: 409 });
  }

  if (result.scanned === 0) {
    return NextResponse.json({
      ok: false,
      reason: 'not_eligible',
      message: 'Lead is not eligible for AI outreach right now (check AI is enabled on this account).',
    }, { status: 422 });
  }

  const hadError = result.errors.length > 0;
  return NextResponse.json({
    ok:      !hadError,
    sent:    result.sent,
    message: result.sent > 0
      ? 'Message sent successfully.'
      : result.retried > 0
        ? 'Send deferred (daily cap or transient error) — will retry.'
        : result.expired > 0
          ? 'Lead has reached the 60-day follow-up limit.'
          : result.optedOut > 0
            ? 'Lead opted out.'
            : hadError
              ? result.errors[0]?.error ?? 'Unknown error'
              : 'No action taken.',
  });
}
