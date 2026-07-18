/**
 * SMS reply attribution for automated sequences (Speed to Lead / Booking
 * System).
 *
 * SMS has no open-rate signal — the only measurable engagement is a reply.
 * When a bride sends an inbound SMS we credit the last automated SMS step
 * that was sent to her (from marketing_automation_execution_logs) with a
 * "first reply". Aggregated across all venues this reveals which message in
 * the standard sequence actually earns responses so the master copy can be
 * tuned over time.
 *
 * Best-effort: every failure is swallowed. This runs inside the GHL webhook
 * which MUST always return 200, and tracking must never block message intake.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { normalizePhone } from '@/lib/ghl';

/** How far back a prior SMS send can be to still get credited for a reply. */
const ATTRIBUTION_WINDOW_DAYS = 75;

interface ExecLogRow {
  automation_id: string;
  enrollment_id: string | null;
  lead_id: string | null;
  step_order: number | null;
  executed_at: string;
}

/**
 * Resolve the lead id(s) behind a venue_customer, most-recent first.
 * Match priority mirrors the AI inbound handler: email exact → phone.
 */
async function resolveLeadIds(venueId: string, venueCustomerId: string): Promise<string[]> {
  const { data: vcRow } = await supabaseAdmin
    .from('venue_customers')
    .select('customer_email, phone')
    .eq('id', venueCustomerId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!vcRow) return [];

  const vc = vcRow as { customer_email: string | null; phone: string | null };
  const email = (vc.customer_email || '').trim().toLowerCase();
  const phoneNorm = normalizePhone(vc.phone);

  const ids: string[] = [];
  const seen = new Set<string>();

  if (email) {
    const { data } = await supabaseAdmin
      .from('leads')
      .select('id, created_at')
      .eq('venue_id', venueId)
      .ilike('email', email)
      .order('created_at', { ascending: false });
    for (const r of (data ?? []) as Array<{ id: string }>) {
      if (!seen.has(r.id)) { seen.add(r.id); ids.push(r.id); }
    }
  }

  if (phoneNorm) {
    // Phone isn't stored normalized, so pull recent leads with a phone and
    // match in JS. Bounded to keep this cheap.
    const { data } = await supabaseAdmin
      .from('leads')
      .select('id, phone, created_at')
      .eq('venue_id', venueId)
      .not('phone', 'is', null)
      .order('created_at', { ascending: false })
      .limit(500);
    for (const r of (data ?? []) as Array<{ id: string; phone: string | null }>) {
      if (normalizePhone(r.phone) === phoneNorm && !seen.has(r.id)) {
        seen.add(r.id);
        ids.push(r.id);
      }
    }
  }

  return ids;
}

/**
 * Record a first-reply credit for an inbound SMS. No-ops silently when there's
 * no matching lead, no prior SMS send, or the enrollment was already credited.
 */
export async function recordSmsReplyAttribution(opts: {
  venueId: string;
  venueCustomerId: string;
  repliedAt?: string;
}): Promise<void> {
  try {
    const repliedAt = opts.repliedAt ?? new Date().toISOString();

    const leadIds = await resolveLeadIds(opts.venueId, opts.venueCustomerId);
    if (leadIds.length === 0) return;

    const sinceIso = new Date(Date.now() - ATTRIBUTION_WINDOW_DAYS * 86_400_000).toISOString();

    // The most recent successful SMS step sent to any matching lead before the
    // reply. That's the message we credit.
    const { data: logRows } = await supabaseAdmin
      .from('marketing_automation_execution_logs')
      .select('automation_id, enrollment_id, lead_id, step_order, executed_at')
      .in('lead_id', leadIds)
      .eq('step_type', 'send_sms')
      .eq('status', 'success')
      .eq('is_test', false)
      .lte('executed_at', repliedAt)
      .gte('executed_at', sinceIso)
      .order('executed_at', { ascending: false })
      .limit(1);

    const log = (logRows ?? [])[0] as ExecLogRow | undefined;
    if (!log || log.step_order == null) return;

    // First-reply guard: if this enrollment already has a credit, stop.
    if (log.enrollment_id) {
      const { data: existing } = await supabaseAdmin
        .from('marketing_sms_reply_events')
        .select('id')
        .eq('enrollment_id', log.enrollment_id)
        .limit(1);
      if (existing && existing.length > 0) return;
    }

    // Snapshot the automation name + the SMS body that earned the reply.
    const [{ data: autoRow }, { data: stepRow }] = await Promise.all([
      supabaseAdmin
        .from('marketing_automations')
        .select('name')
        .eq('id', log.automation_id)
        .maybeSingle(),
      supabaseAdmin
        .from('marketing_automation_steps')
        .select('config_json')
        .eq('automation_id', log.automation_id)
        .eq('step_order', log.step_order)
        .maybeSingle(),
    ]);

    const automationName = (autoRow as { name?: string } | null)?.name ?? null;
    const cfg = ((stepRow as { config_json?: Record<string, unknown> } | null)?.config_json ?? {}) as Record<string, unknown>;
    const stepBody = typeof cfg.body === 'string' ? cfg.body : null;

    const sentAt = log.executed_at;
    const hoursToReply = sentAt
      ? Math.max(0, (new Date(repliedAt).getTime() - new Date(sentAt).getTime()) / 3_600_000)
      : null;

    await supabaseAdmin
      .from('marketing_sms_reply_events')
      .insert({
        venue_id:       opts.venueId,
        automation_id:  log.automation_id,
        automation_name: automationName,
        enrollment_id:  log.enrollment_id,
        lead_id:        log.lead_id,
        step_order:     log.step_order,
        step_body:      stepBody,
        is_custom_body: false,
        sent_at:        sentAt,
        replied_at:     repliedAt,
        hours_to_reply: hoursToReply != null ? Number(hoursToReply.toFixed(2)) : null,
      });
  } catch (e) {
    console.error('[sms-reply-tracking] recordSmsReplyAttribution failed (non-fatal):', e);
  }
}
