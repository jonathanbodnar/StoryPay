/**
 * POST /api/admin/ai-concierge/leads/[leadId]/force-send
 *
 * Super-admin action: immediately runs the AI send pipeline for one lead,
 * bypassing both the scheduled time and quiet-hours checks. Used from the
 * AI Concierge monitor "Send Now" button so the team can test or manually
 * trigger outreach without waiting for the 10-minute cron.
 *
 * The lead must be in ai_state='ai_active'. Spend-cap, expiry, and DND
 * checks still apply (those protect budget and compliance).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { runAiSendCron } from '@/lib/ai-concierge/send-cron';

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const maxDuration = 60; // DeepSeek + SMS send can take ~20s

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { leadId } = await params;
  if (!leadId?.trim()) {
    return NextResponse.json({ error: 'Missing leadId' }, { status: 400 });
  }

  console.log(`[ai-monitor] force-send triggered for lead ${leadId}`);

  let result;
  try {
    result = await runAiSendCron({
      maxLeads:         1,
      reservationMinutes: 15,
      leadIdFilter:     leadId,
      bypassQuietHours: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    const stack = e instanceof Error ? e.stack : undefined;
    console.error(`[ai-monitor] force-send threw for lead ${leadId}:`, msg, stack);
    return NextResponse.json({
      ok: false,
      message: `Server error: ${msg}`,
    }, { status: 500 });
  }

  if (result.killSwitchEngaged) {
    return NextResponse.json({
      ok: false,
      reason: 'kill_switch',
      message: `Global kill switch is enabled${result.killSwitchReason ? `: ${result.killSwitchReason}` : ''}. Disable it first.`,
    }, { status: 409 });
  }

  if (result.scanned === 0) {
    return NextResponse.json({
      ok: false,
      reason: 'not_eligible',
      message: 'Lead not found or not in ai_active state. Check that AI is enabled on the venue and the lead is active.',
    }, { status: 422 });
  }

  const hadError = result.errors.length > 0;
  return NextResponse.json({
    ok:      !hadError,
    sent:    result.sent,
    result:  {
      sent:     result.sent,
      expired:  result.expired,
      retried:  result.retried,
      optedOut: result.optedOut,
      errors:   result.errors,
    },
    durationMs: result.durationMs,
    message: result.sent > 0
      ? 'Message sent successfully.'
      : result.retried > 0
        ? 'Send deferred (quiet hours, cap, or transient error) — will retry.'
        : result.expired > 0
          ? 'Lead has expired (60-day cap reached).'
          : result.optedOut > 0
            ? 'Lead opted out or has a bad phone number.'
            : hadError
              ? result.errors[0]?.error ?? 'Unknown error'
              : 'No action taken.',
  });
}
