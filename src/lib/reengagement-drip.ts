/**
 * Re-engagement drip engine.
 *
 * Targets venues that:
 *   - completed listing setup (onboarding_activated_at IS NOT NULL)
 *   - never added a CC (directory_subscription_status NOT IN active/past_due/canceled)
 *   - have NOT explicitly downgraded/canceled
 *   - are not demo accounts
 *
 * Schedule (days after drip started_at):
 *   1  →  Day 2
 *   2  →  Day 5
 *   3  →  Day 12
 *   4  →  Day 19
 *   5  →  Day 26
 *   6  →  Day 36
 *   7  →  Day 46
 *   8  →  Day 56
 *   9  →  Day 66
 *  10  →  Day 76
 *  11  →  Day 86
 *
 * Stops early when:
 *   - venue logs in after the drip started
 *   - venue adds CC (subscription becomes active/past_due)
 *   - venue explicitly cancels (subscription = canceled)
 *   - all 11 emails sent
 */

import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { SYSTEM_EMAIL_BY_KEY, SYSTEM_EMAIL_SAMPLE_VARS } from '@/lib/system-email-registry';
import { fillTemplate } from '@/lib/email-templates';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/$/, '');

// Days offset from started_at for each send (1-indexed).
export const DRIP_DAY_OFFSETS = [2, 5, 12, 19, 26, 36, 46, 56, 66, 76, 86] as const;
export const DRIP_TOTAL = DRIP_DAY_OFFSETS.length;

/** Compute the timestamp for a given send index (0-based). */
export function dripSendAt(startedAt: Date, sendIndex: number): Date {
  const d = new Date(startedAt.getTime());
  d.setDate(d.getDate() + DRIP_DAY_OFFSETS[sendIndex]);
  return d;
}

// ── Template helpers ──────────────────────────────────────────────────────────

interface TemplateOverride {
  subject: string;
  heading: string;
  body: string;
  button_text: string | null;
}

async function loadTemplate(): Promise<TemplateOverride> {
  const def = SYSTEM_EMAIL_BY_KEY['reengagement_drip']!;
  const { data } = await supabaseAdmin
    .from('system_email_templates')
    .select('subject, heading, body, button_text')
    .eq('key', 'reengagement_drip')
    .maybeSingle();

  return {
    subject:     (data?.subject     as string | null) ?? def.defaults.subject,
    heading:     (data?.heading     as string | null) ?? def.defaults.heading,
    body:        (data?.body        as string | null) ?? def.defaults.body,
    button_text: (data?.button_text as string | null) ?? def.defaults.button_text ?? null,
  };
}

function buildHtml(tpl: TemplateOverride, vars: Record<string, string>): string {
  const heading = fillTemplate(tpl.heading, vars);
  const body    = fillTemplate(tpl.body, vars);
  const btn     = tpl.button_text ? fillTemplate(tpl.button_text, vars) : null;
  const actionUrl = vars.action_url ?? APP_URL;

  const bodyHtml = body
    .split('\n')
    .map((line) =>
      line.trim() === ''
        ? '<div style="height:8px"></div>'
        : `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0">${line}</p>`,
    )
    .join('\n');

  const buttonHtml = btn
    ? `<div style="text-align:center;margin:32px 0">
        <a href="${actionUrl}"
          style="background-color:#1b1b1b;border-radius:10px;color:#ffffff;display:inline-block;font-family:'Open Sans',Arial,sans-serif;font-size:16px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;width:240px;-webkit-text-size-adjust:none;">
          <span style="color:#ffffff;text-decoration:none;">${btn}</span>
        </a>
      </div>`
    : '';

  return `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff">
  <div style="background-color:#1b1b1b;padding:24px 32px 20px;border-radius:12px 12px 0 0">
    <span style="font-size:16px;font-weight:700;color:#ffffff;font-family:'Open Sans',Arial,sans-serif;">StoryVenue</span>
  </div>
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 20px">${heading}</h2>
    ${bodyHtml}
    ${buttonHtml}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px">
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0">Sent by StoryVenue &middot; <a href="${APP_URL}/unsubscribe" style="color:#9ca3af">Unsubscribe</a></p>
  </div>
</div>`;
}

// ── Enroll ────────────────────────────────────────────────────────────────────

/**
 * Enroll a venue in the re-engagement drip. Safe to call multiple times — uses
 * an upsert and does nothing if the venue already has an active drip.
 */
export async function enrollReengagementDrip(venueId: string): Promise<void> {
  const startedAt = new Date();
  const nextSendAt = dripSendAt(startedAt, 0); // Day 2

  const { error } = await supabaseAdmin
    .from('venue_reengagement_drip')
    .upsert(
      {
        venue_id: venueId,
        started_at: startedAt.toISOString(),
        next_send_at: nextSendAt.toISOString(),
        emails_sent: 0,
        status: 'active',
      },
      { onConflict: 'venue_id', ignoreDuplicates: true },
    );

  if (error && !/column/i.test(error.message)) {
    console.error('[drip] enroll failed:', error.message, 'venueId:', venueId);
  }
}

// ── Cancel ────────────────────────────────────────────────────────────────────

export type DripCancelReason = 'converted' | 'canceled' | 'paused';

export async function cancelReengagementDrip(
  venueId: string,
  reason: DripCancelReason = 'converted',
): Promise<void> {
  await supabaseAdmin
    .from('venue_reengagement_drip')
    .update({ status: reason, completed_at: new Date().toISOString() })
    .eq('venue_id', venueId)
    .eq('status', 'active');
}

// ── Cron processor ───────────────────────────────────────────────────────────

interface DripRow {
  id: string;
  venue_id: string;
  started_at: string;
  emails_sent: number;
  status: string;
}

interface VenueRow {
  id: string;
  name: string;
  email: string;
  notification_email: string | null;
  owner_first_name: string | null;
  last_login_at: string | null;
  directory_subscription_status: string | null;
  is_demo: boolean | null;
  directory_card_on_file: boolean | null;
}

export interface DripRunResult {
  processed: number;
  sent: number;
  stopped: number;
  errors: string[];
}

export async function runReengagementDripCron(): Promise<DripRunResult> {
  const result: DripRunResult = { processed: 0, sent: 0, stopped: 0, errors: [] };
  const now = new Date().toISOString();

  // Fetch drips due to send
  const { data: dueDrips, error: fetchErr } = await supabaseAdmin
    .from('venue_reengagement_drip')
    .select('id, venue_id, started_at, emails_sent, status')
    .eq('status', 'active')
    .lte('next_send_at', now)
    .order('next_send_at', { ascending: true })
    .limit(100);

  if (fetchErr) {
    result.errors.push(`Fetch drips: ${fetchErr.message}`);
    return result;
  }

  if (!dueDrips?.length) return result;

  // Load venue data for each drip
  const venueIds = [...new Set(dueDrips.map((d) => (d as DripRow).venue_id))];
  const baseVenueCols =
    'id, name, email, notification_email, owner_first_name, last_login_at, directory_subscription_status, is_demo';
  let venues: Record<string, unknown>[] | null = null;
  const fullV = await supabaseAdmin
    .from('venues')
    .select(`${baseVenueCols}, directory_card_on_file`)
    .in('id', venueIds);
  if (fullV.error && /directory_card_on_file/.test(fullV.error.message)) {
    const slimV = await supabaseAdmin.from('venues').select(baseVenueCols).in('id', venueIds);
    venues = (slimV.data ?? null) as Record<string, unknown>[] | null;
  } else {
    venues = (fullV.data ?? null) as Record<string, unknown>[] | null;
  }

  const venueMap = new Map<string, VenueRow>(
    ((venues ?? []) as unknown as VenueRow[]).map((v) => [v.id, v]),
  );

  const tpl = await loadTemplate();

  for (const row of dueDrips as DripRow[]) {
    result.processed++;
    const venue = venueMap.get(row.venue_id);

    // --- Stop conditions ---
    const subStatus = venue?.directory_subscription_status ?? null;
    const isActive  = subStatus === 'active' || subStatus === 'past_due';
    const isCanceled = subStatus === 'canceled';
    const isDemo    = venue?.is_demo === true;
    const hasCard   = venue?.directory_card_on_file === true;

    // Converted — they added a card (paid trial OR Free-plan onboarder).
    if (isActive || isCanceled || isDemo || hasCard || !venue) {
      const stopReason: DripCancelReason = (isActive || hasCard) ? 'converted' : 'canceled';
      await supabaseAdmin
        .from('venue_reengagement_drip')
        .update({ status: stopReason, completed_at: now })
        .eq('id', row.id);
      result.stopped++;
      continue;
    }

    // Logged in after drip started
    if (venue.last_login_at && venue.last_login_at > row.started_at) {
      await supabaseAdmin
        .from('venue_reengagement_drip')
        .update({ status: 'converted', completed_at: now })
        .eq('id', row.id);
      result.stopped++;
      continue;
    }

    // --- Send the email ---
    const toEmail = (venue.notification_email || venue.email || '').trim();
    if (!toEmail) {
      result.errors.push(`No email for venue ${row.venue_id}`);
      continue;
    }

    const sendIndex = row.emails_sent; // 0-based
    const vars: Record<string, string> = {
      owner_first_name: venue.owner_first_name?.trim() || 'there',
      venue_name:       venue.name?.trim() || 'your venue',
      action_url:       `${APP_URL}/dashboard`,
    };

    const subject = fillTemplate(tpl.subject, vars);
    const html    = buildHtml(tpl, vars);

    try {
      await sendEmail({
        to:      toEmail,
        subject,
        html,
      });

      const nextIndex = sendIndex + 1;
      const emailsSent = row.emails_sent + 1;
      const isDone = nextIndex >= DRIP_TOTAL;

      await supabaseAdmin
        .from('venue_reengagement_drip')
        .update({
          last_sent_at: now,
          emails_sent: emailsSent,
          next_send_at: isDone
            ? null
            : dripSendAt(new Date(row.started_at), nextIndex).toISOString(),
          status: isDone ? 'completed' : 'active',
          completed_at: isDone ? now : null,
        })
        .eq('id', row.id);

      result.sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Send to ${toEmail} (venue ${row.venue_id}): ${msg}`);
    }
  }

  return result;
}

// ── Test send helper (used by super admin) ────────────────────────────────────

export async function sendTestReengagementEmail(toEmail: string): Promise<void> {
  const tpl = await loadTemplate();
  const vars = { ...SYSTEM_EMAIL_SAMPLE_VARS['reengagement_drip'] ?? {} };
  vars.action_url = vars.action_url ?? APP_URL;

  const subject = fillTemplate(tpl.subject, vars);
  const html    = buildHtml(tpl, vars);

  await sendEmail({ to: toEmail, subject, html });
}

// ── Preview helper ────────────────────────────────────────────────────────────

export async function previewReengagementEmail(): Promise<string> {
  const tpl = await loadTemplate();
  const vars = { ...SYSTEM_EMAIL_SAMPLE_VARS['reengagement_drip'] ?? {} };
  vars.action_url = vars.action_url ?? APP_URL;
  return buildHtml(tpl, vars);
}
