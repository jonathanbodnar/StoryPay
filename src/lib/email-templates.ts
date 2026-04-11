/**
 * Shared email template helpers.
 *
 * All outbound email routes should call getVenueEmailTemplate() to load the
 * venue's saved template (or fall back to the default), then buildEmailHtml()
 * to render the final HTML using the venue's branding.
 */

import { supabaseAdmin } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailTemplateRow {
  type: string;
  subject: string;
  heading: string;
  body: string;
  button_text: string | null;
  footer: string | null;
  enabled: boolean;
}

// ─── Defaults (kept in sync with the API route) ───────────────────────────────

const DEFAULTS: Record<string, Omit<EmailTemplateRow, 'type' | 'enabled'>> = {
  invoice: {
    subject:     'Invoice from {{organization}}',
    heading:     'You have a new invoice',
    body:        'Hi {{customer_name}},\n\nYou have a new invoice from {{organization}} for {{amount}}.\n\nPlease review and complete your payment at your earliest convenience.',
    button_text: 'View & Pay Invoice',
    footer:      null,
  },
  proposal: {
    subject:     'Proposal from {{organization}}',
    heading:     'Your Proposal is Ready',
    body:        'Hi {{customer_name}},\n\n{{organization}} has sent you a proposal. Please review, sign, and complete your payment to secure your date.',
    button_text: 'View & Sign Proposal',
    footer:      null,
  },
  payment_confirmation: {
    subject:     'Payment receipt from {{organization}} — {{amount}}',
    heading:     'Payment Successful',
    body:        'Hi {{customer_name}},\n\nYour payment of {{amount}} to {{organization}} on {{date}} has been processed successfully.\n\nThank you for your payment!',
    button_text: null,
    footer:      null,
  },
  payment_notification: {
    subject:     'Payment received: {{amount}} from {{customer_name}}',
    heading:     'New Payment Received',
    body:        "You've received a new payment for {{organization}}.\n\nCustomer: {{customer_name}}\nAmount: {{amount}}",
    button_text: 'View in Dashboard',
    footer:      null,
  },
  subscription_confirmation: {
    subject:     'Subscription confirmed with {{organization}}',
    heading:     'Subscription Confirmed',
    body:        'Hi {{customer_name}},\n\nYour subscription with {{organization}} is now active.\n\nAmount: {{amount}} {{frequency}}\nNext payment: {{next_payment_date}}',
    button_text: null,
    footer:      null,
  },
  subscription_cancelled: {
    subject:     'Subscription cancelled — {{organization}}',
    heading:     'Subscription Cancelled',
    body:        'Hi {{customer_name}},\n\nYour subscription with {{organization}} has been cancelled as requested.',
    button_text: null,
    footer:      null,
  },
  payment_failed: {
    subject:     'Action required: Payment failed — {{organization}}',
    heading:     'Payment Failed',
    body:        'Hi {{customer_name}},\n\nWe were unable to process your payment of {{amount}} to {{organization}}.\n\nReason: {{reason}}\n\nPlease update your payment method.',
    button_text: 'Update Payment Method',
    footer:      null,
  },
};

// ─── Loader ───────────────────────────────────────────────────────────────────

/**
 * Load the saved template for a venue + type, falling back to the default.
 * Returns null only when the type is unknown.
 */
export async function getVenueEmailTemplate(
  venueId: string,
  type: string
): Promise<EmailTemplateRow | null> {
  const defaultMeta = DEFAULTS[type];
  if (!defaultMeta) return null;

  const { data } = await supabaseAdmin
    .from('venue_email_templates')
    .select('subject, heading, body, button_text, footer, enabled')
    .eq('venue_id', venueId)
    .eq('type', type)
    .maybeSingle();

  // If the venue has disabled this email type, return null so callers can skip
  if (data && data.enabled === false) return null;

  return {
    type,
    subject:     data?.subject     ?? defaultMeta.subject,
    heading:     data?.heading     ?? defaultMeta.heading,
    body:        data?.body        ?? defaultMeta.body,
    button_text: data?.button_text ?? defaultMeta.button_text ?? null,
    footer:      data?.footer      ?? defaultMeta.footer      ?? null,
    enabled:     data?.enabled     ?? true,
  };
}

// ─── Variable substitution ────────────────────────────────────────────────────

export function fillTemplate(
  text: string,
  vars: Record<string, string>
): string {
  let out = text;
  for (const [key, val] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, val);
  }
  return out;
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

/**
 * Render a template row into a full HTML email using the venue's branding.
 * Call fillTemplate() on subject separately (not HTML).
 */
export function buildEmailHtml({
  template,
  vars,
  actionUrl,
  brandColor = '#1b1b1b',
  logoUrl,
  venueName,
}: {
  template: EmailTemplateRow;
  vars: Record<string, string>;
  actionUrl?: string;
  brandColor?: string;
  logoUrl?: string;
  venueName: string;
}): string {
  const heading = fillTemplate(template.heading, vars);
  const body    = fillTemplate(template.body, vars);
  const btnText = template.button_text ? fillTemplate(template.button_text, vars) : null;
  const footer  = template.footer ? fillTemplate(template.footer, vars) : null;

  const buttonHtml = (btnText && actionUrl)
    ? `<div style="text-align:center;margin:32px 0">
        <a href="${actionUrl}" style="display:inline-block;background-color:${brandColor};color:white;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px">
          ${btnText}
        </a>
      </div>
      <p style="color:#9ca3af;font-size:12px;text-align:center;margin:8px 0 0">
        If the button doesn't work, copy this link:<br>
        <a href="${actionUrl}" style="color:${brandColor}">${actionUrl}</a>
      </p>`
    : '';

  const footerHtml = footer
    ? `<p style="color:#9ca3af;font-size:12px;text-align:center;margin:16px 0 0">${footer}</p>`
    : '';

  // Convert plain-text body (newlines) to paragraphs
  const bodyHtml = body
    .split('\n')
    .map(line => line.trim() === ''
      ? '<div style="height:8px"></div>'
      : `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0">${line}</p>`)
    .join('\n');

  // Header: when logo is present use a white background so any logo color is visible.
  // Transparent PNGs, dark logos, and light logos all work on white.
  // Brand color becomes an accent bar below the logo and is used on the CTA button.
  // When no logo: full brand-color header with venue name text.
  const hasLogo = logoUrl && logoUrl.trim().length > 0;
  const headerHtml = hasLogo
    ? `<div style="background-color:#ffffff;padding:20px 32px 16px;border-radius:12px 12px 0 0;border:1px solid #e5e7eb;border-bottom:4px solid ${brandColor}">
        <img src="${logoUrl}" alt="${venueName}" style="max-height:60px;max-width:200px;width:auto;height:auto;display:block;background-color:#ffffff">
       </div>`
    : `<div style="background-color:${brandColor};padding:28px 32px;border-radius:12px 12px 0 0">
        <h1 style="color:white;font-size:22px;margin:0;font-weight:300">${venueName}</h1>
       </div>`;

  return `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff">
  ${headerHtml}
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 20px">${heading}</h2>
    ${bodyHtml}
    ${buttonHtml}
    ${footerHtml}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px">
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0">Sent via StoryPay on behalf of ${venueName}</p>
  </div>
</div>`;
}
