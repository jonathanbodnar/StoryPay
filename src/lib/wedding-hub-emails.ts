/**
 * Wedding Hub transactional emails:
 *   - wedding_hub_invite     — sent to the bride when a venue invites her to connect.
 *   - wedding_hub_connected  — sent to the venue owner when the bride accepts.
 *
 * Both are editable System Email Templates (super admin → System Emails),
 * falling back to the registry defaults in system-email-registry.ts when no
 * override is saved. Rendered through the shared StoryVenue email chassis
 * (buildSystemEmail) so they match every other transactional email.
 *
 * The generic /api/admin/system-emails/{test,preview} routes already handle
 * test-sends and previews for both keys via SYSTEM_EMAIL_BY_KEY +
 * SYSTEM_EMAIL_SAMPLE_VARS — no extra wiring needed there.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { SYSTEM_EMAIL_BY_KEY } from '@/lib/system-email-registry';
import { fillTemplate, buildSystemEmail } from '@/lib/email-templates';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/$/, '');

interface TemplateOverride {
  subject: string;
  heading: string;
  body: string;
  button_text: string | null;
}

async function loadTemplate(key: 'wedding_hub_invite' | 'wedding_hub_connected'): Promise<TemplateOverride> {
  const def = SYSTEM_EMAIL_BY_KEY[key]!;
  const { data } = await supabaseAdmin
    .from('system_email_templates')
    .select('subject, heading, body, button_text')
    .eq('key', key)
    .maybeSingle();

  return {
    subject:     (data?.subject     as string | null) ?? def.defaults.subject,
    heading:     (data?.heading     as string | null) ?? def.defaults.heading,
    body:        (data?.body        as string | null) ?? def.defaults.body,
    button_text: (data?.button_text as string | null) ?? def.defaults.button_text ?? null,
  };
}

function buildHtml(tpl: TemplateOverride, vars: Record<string, string>, footerText: string): string {
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

  return buildSystemEmail({
    title: heading,
    heading,
    bodyHtml,
    cta: btn ? { label: btn, url: actionUrl } : undefined,
    showLinkFallback: true,
    footerHtml: `<p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;">${footerText}</p>`,
  });
}

// ── Bride invite ─────────────────────────────────────────────────────────────

export interface SendWeddingHubInviteParams {
  toEmail: string;
  brideFirstName: string;
  venueName: string;
  claimUrl: string;
  /** Days until the claim link expires — shown in the footer. */
  expiresInDays: number;
  /** Venue's verified brand email, if any — falls back to the default From. */
  brandEmail?: string;
}

export async function sendWeddingHubInviteEmail(
  params: SendWeddingHubInviteParams,
): Promise<{ success: boolean; error?: string }> {
  const { toEmail, brideFirstName, venueName, claimUrl, expiresInDays, brandEmail } = params;
  const vars: Record<string, string> = {
    bride_first_name: brideFirstName.trim() || 'there',
    venue_name: venueName,
    action_url: claimUrl,
  };
  const tpl = await loadTemplate('wedding_hub_invite');
  const subject = fillTemplate(tpl.subject, vars);
  const html = buildHtml(
    tpl,
    vars,
    `This invite expires in ${expiresInDays} days. Sent by StoryVenue on behalf of ${venueName}.`,
  );
  return sendEmail({ to: toEmail, subject, html, from: { name: venueName, email: brandEmail } });
}

// ── Venue "couple connected" notification ───────────────────────────────────

export interface SendWeddingHubConnectedParams {
  toEmail: string;
  cc?: string[];
  ownerFirstName: string;
  brideName: string;
  venueName: string;
}

export async function sendWeddingHubConnectedEmail(
  params: SendWeddingHubConnectedParams,
): Promise<{ success: boolean; error?: string }> {
  const { toEmail, cc, ownerFirstName, brideName, venueName } = params;
  const vars: Record<string, string> = {
    owner_first_name: ownerFirstName.trim() || 'there',
    bride_name: brideName.trim() || 'Your couple',
    venue_name: venueName,
    action_url: `${APP_URL}/dashboard/wedding-hub`,
  };
  const tpl = await loadTemplate('wedding_hub_connected');
  const subject = fillTemplate(tpl.subject, vars);
  const html = buildHtml(tpl, vars, 'Sent by StoryVenue · Wedding Hub');
  return sendEmail({ to: toEmail, cc, subject, html });
}
