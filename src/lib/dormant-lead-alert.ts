/**
 * Lead alert email for dormant venues.
 *
 * Fired when a real bride submits an inquiry on a listing where the venue
 * completed setup (onboarding_activated_at IS NOT NULL) but has NOT yet added
 * a credit card (directory_subscription_status not active/past_due).
 *
 * The email shows the bride's first name + last initial but intentionally hides
 * full contact info — the venue must log in to see it.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { SYSTEM_EMAIL_BY_KEY, SYSTEM_EMAIL_SAMPLE_VARS } from '@/lib/system-email-registry';
import { fillTemplate, buildSystemEmail } from '@/lib/email-templates';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/$/, '');

interface TemplateOverride {
  subject: string;
  heading: string;
  body: string;
  button_text: string | null;
}

async function loadTemplate(): Promise<TemplateOverride> {
  const def = SYSTEM_EMAIL_BY_KEY['dormant_lead_alert']!;
  const { data } = await supabaseAdmin
    .from('system_email_templates')
    .select('subject, heading, body, button_text')
    .eq('key', 'dormant_lead_alert')
    .maybeSingle();

  return {
    subject:     (data?.subject     as string | null) ?? def.defaults.subject,
    heading:     (data?.heading     as string | null) ?? def.defaults.heading,
    body:        (data?.body        as string | null) ?? def.defaults.body,
    button_text: (data?.button_text as string | null) ?? def.defaults.button_text ?? null,
  };
}

function buildHtml(tpl: TemplateOverride, vars: Record<string, string>): string {
  const heading    = fillTemplate(tpl.heading, vars);
  const body       = fillTemplate(tpl.body, vars);
  const btn        = tpl.button_text ? fillTemplate(tpl.button_text, vars) : null;
  const actionUrl  = vars.action_url ?? APP_URL;

  const bodyHtml = body
    .split('\n')
    .map((line) =>
      line.trim() === ''
        ? '<div style="height:8px"></div>'
        : `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0">${line}</p>`,
    )
    .join('\n');

  return buildSystemEmail({
    title:      heading,
    heading,
    bodyHtml,
    cta:        btn ? { label: btn, url: actionUrl } : undefined,
    footerHtml: `<p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;">Sent by StoryVenue on behalf of your listing</p>`,
  });
}

// ── Dormant check ─────────────────────────────────────────────────────────────

interface VenueRow {
  id: string;
  name: string;
  email: string;
  notification_email: string | null;
  owner_first_name: string | null;
  onboarding_activated_at: string | null;
  directory_subscription_status: string | null;
  is_demo: boolean | null;
}

export async function isDormantVenue(venueId: string): Promise<boolean> {
  // Select card-on-file tolerantly: the column (migration 174) may not exist on
  // older schemas, in which case we fall back to the pre-174 behavior.
  let data: Record<string, unknown> | null = null;
  const full = await supabaseAdmin
    .from('venues')
    .select('id, onboarding_activated_at, directory_subscription_status, is_demo, directory_card_on_file')
    .eq('id', venueId)
    .maybeSingle();
  if (full.error && /directory_card_on_file/.test(full.error.message)) {
    const slim = await supabaseAdmin
      .from('venues')
      .select('id, onboarding_activated_at, directory_subscription_status, is_demo')
      .eq('id', venueId)
      .maybeSingle();
    data = (slim.data ?? null) as Record<string, unknown> | null;
  } else {
    data = (full.data ?? null) as Record<string, unknown> | null;
  }

  if (!data) return false;

  // Card on file (paid trial OR Free-plan onboarder) → not dormant. Free
  // onboarders get dedicated nudges later, not these.
  if (data.directory_card_on_file === true) return false;
  // Must have sent test lead (listing complete)
  if (!data.onboarding_activated_at) return false;
  // Must not have active/past_due subscription
  const sub = String(data.directory_subscription_status ?? '');
  if (sub === 'active' || sub === 'past_due') return false;
  // Not a demo account
  if (data.is_demo) return false;

  return true;
}

// ── Send ──────────────────────────────────────────────────────────────────────

export interface SendLeadAlertParams {
  venueId: string;
  leadFirstName: string;
  leadLastName: string;
}

export async function maybeSendDormantLeadAlert(params: SendLeadAlertParams): Promise<void> {
  const { venueId, leadFirstName, leadLastName } = params;

  try {
    const dormant = await isDormantVenue(venueId);
    if (!dormant) return;

    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('id, name, email, notification_email, owner_first_name')
      .eq('id', venueId)
      .maybeSingle();

    if (!venue) return;
    const v = venue as VenueRow;

    const toEmail = (v.notification_email || v.email || '').trim();
    if (!toEmail) return;

    const lastInitial = (leadLastName || '').trim().charAt(0).toUpperCase() || '';
    const vars: Record<string, string> = {
      owner_first_name: v.owner_first_name?.trim() || 'there',
      venue_name:       v.name?.trim() || 'your venue',
      lead_first_name:  (leadFirstName || '').trim() || 'Someone',
      lead_last_initial: lastInitial,
      action_url:       `${APP_URL}/dashboard/leads`,
    };

    const tpl = await loadTemplate();
    const subject = fillTemplate(tpl.subject, vars);
    const html    = buildHtml(tpl, vars);

    await sendEmail({ to: toEmail, subject, html });
  } catch (err) {
    console.error('[dormant-lead-alert] failed:', err);
    // Non-fatal — don't disrupt the lead submission flow
  }
}

// ── Test send / preview (super admin) ────────────────────────────────────────

export async function sendTestDormantLeadAlert(toEmail: string): Promise<void> {
  const tpl  = await loadTemplate();
  const vars = { ...SYSTEM_EMAIL_SAMPLE_VARS['dormant_lead_alert'] ?? {} };
  vars.action_url = vars.action_url ?? APP_URL;

  const subject = fillTemplate(tpl.subject, vars);
  const html    = buildHtml(tpl, vars);

  await sendEmail({ to: toEmail, subject, html });
}

export async function previewDormantLeadAlert(): Promise<string> {
  const tpl  = await loadTemplate();
  const vars = { ...SYSTEM_EMAIL_SAMPLE_VARS['dormant_lead_alert'] ?? {} };
  vars.action_url = vars.action_url ?? APP_URL;
  return buildHtml(tpl, vars);
}
