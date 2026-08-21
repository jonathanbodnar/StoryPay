/**
 * Shared email template helpers.
 *
 * All outbound email routes should call getVenueEmailTemplate() to load the
 * venue's saved template (or fall back to the default), then buildEmailHtml()
 * to render the final HTML using the venue's branding.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { renderMergeVars, systemDateVars, enrichTransactionalVars } from '@/lib/merge-variables';

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
    body:        'Hi {{customer_name}},\n\nYour payment of {{amount}} to {{organization}} on {{date}} has been processed successfully.\n\n{{balance_line}}\n\nThank you for your payment!',
    button_text: 'View all payments',
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
  // Customer-facing "your payment didn't go through" email. Sent to the
  // BRIDE directly from the checkout-decline handler in
  // verify-payment/route.ts — separate from owner_payment_failed below,
  // which is the venue owner's own alert that a customer's payment failed.
  payment_failed: {
    subject:     'Action required: Payment failed — {{organization}}',
    heading:     'Payment Failed',
    body:        'Hi {{customer_name}},\n\nWe were unable to process your payment of {{amount}} to {{organization}}.\n\nReason: {{reason}}\n\nPlease update your payment method.',
    button_text: 'Update Payment Method',
    footer:      null,
  },
  // Owner-side "a customer's payment failed" alert. Fires from
  // owner-notifications.ts's payment_failed scenario. Kept separate from
  // the customer-facing `payment_failed` template above so editing one
  // never accidentally changes what the other audience sees.
  owner_payment_failed: {
    subject:     'Payment failed: {{customer_name}} — {{amount}}',
    heading:     'Payment Failed',
    body:        'A payment attempt for {{organization}} did not complete.\n\nCustomer: {{customer_name}}\nAmount: {{amount}}\nReason: {{reason}}',
    button_text: 'View in Dashboard',
    footer:      null,
  },
  payment_reminder: {
    subject:     'Payment overdue: {{amount}} was due {{due_date}} — {{organization}}',
    heading:     'Payment overdue',
    body:        'Hi {{customer_name}},\n\nThis is a friendly reminder that a payment to {{organization}} is now overdue.\n\nAmount due: {{amount}}\nOriginal due date: {{due_date}}\n\nPlease complete your payment at your earliest convenience.',
    button_text: 'View & Pay Now',
    footer:      null,
  },
  document_viewed: {
    subject:     '{{customer_name}} just viewed their document — {{organization}}',
    heading:     'Document Viewed',
    body:        'Good news — {{customer_name}} just opened their proposal or invoice from {{organization}}.\n\nNow is a great time to follow up if they have any questions.',
    button_text: 'View in Dashboard',
    footer:      null,
  },
  proposal_signed: {
    subject:     '{{customer_name}} signed a proposal — {{organization}}',
    heading:     'Proposal Signed',
    body:        '{{customer_name}} just signed a proposal with {{organization}}.\n\nAmount: {{amount}}\n\nReview the signed proposal and reach out to confirm next steps.',
    button_text: 'View Proposal',
    footer:      null,
  },
  // Owner-side "a contact replied" email. Fires on every inbound reply (the
  // first reply after a public-listing form fill, and every reply while the AI
  // Concierge is active so the owner can step in and take the conversation
  // over). Without this default, getVenueEmailTemplate() returned null for the
  // 'new_message' scenario and the email never sent.
  new_message: {
    subject:     '{{customer_name}} replied — {{organization}}',
    heading:     'New reply from {{customer_name}}',
    body:        '{{customer_name}} just replied to {{organization}}.\n\n"{{message_preview}}"\n\nIf the AI Concierge is active it may respond automatically — open the conversation to review and take it over anytime.',
    button_text: 'View Conversation',
    footer:      null,
  },
  // Owner-side "new lead" email. Fires the first time a lead is captured
  // (public-listing form fill, manual add, or API). Push-only before this
  // default existed.
  new_lead: {
    subject:     'New lead: {{customer_name}} — {{organization}}',
    heading:     'New Lead',
    body:        'You have a new lead for {{organization}}.\n\nName: {{customer_name}}\nEmail: {{email}}\nSource: {{source}}\n\nReach out while they\u2019re hot — open their contact to start the conversation.',
    button_text: 'View Lead',
    footer:      null,
  },
  // Owner-side "AI Concierge handed off to you" email. Fires when the AI
  // escalates a conversation (pricing question, urgent/negative intent) and
  // the owner needs to step in. Push-only before this default existed.
  ai_handoff: {
    subject:     'Action needed: AI Concierge handed off {{customer_name}} — {{organization}}',
    heading:     'AI Concierge Handoff',
    body:        'The AI Concierge handed the conversation with {{customer_name}} off to you.\n\nReason: {{reason}}\n\nOpen the conversation to take over and reply.',
    button_text: 'View Conversation',
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
  // Enrich with canonical equivalents before rendering so both flat tags
  // ({{customer_name}}) and canonical tags ({{contact.first_name}}) resolve.
  return renderMergeVars(text, enrichTransactionalVars({ ...systemDateVars(), ...vars }));
}

// ─── Shared system email chassis ───────────────────────────────────────────────

/**
 * The canonical StoryVenue email look, extracted from the Venue Direct email.
 * Light-grey page background, a centered white card with a rounded border, a
 * centered logo, a bold headline, freeform body HTML, an optional centered CTA
 * button, and an optional footer region above the card's bottom edge.
 *
 * Every system + transactional email should render through this so the whole
 * product shares one look and feel. Pass a venue logo + brand color for
 * venue-branded mail (invoices, proposals, receipts) or leave them off to get
 * the StoryVenue platform branding (concierge alerts, venue-direct, etc.).
 */
export const STORYVENUE_DARK_LOGO_URL =
  (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '') +
  '/storyvenue-logo-dark.png';

export interface SystemEmailOptions {
  /** Centered logo at the top of the card. Defaults to the StoryVenue dark logo. */
  logoUrl?: string;
  /** Alt text for the logo image. */
  logoAlt?: string;
  /** @deprecated Ignored. We never render a text logo — when `logoUrl` is empty
   *  we fall back to the black StoryVenue logo image. Kept for caller compatibility. */
  brandName?: string;
  /** Accent color for the CTA button + inline links. Defaults to #1b1b1b. */
  accentColor?: string;
  /** Hidden inbox-preview text (never visibly rendered). */
  preheader?: string;
  /** <title> element. */
  title?: string;
  /** Centered headline. An array renders each entry on its own line at the same size/weight. */
  heading?: string | string[];
  /** Main body content — raw, pre-rendered HTML. */
  bodyHtml: string;
  /** Centered call-to-action button. */
  cta?: { label: string; url: string };
  /** When true (and a real CTA url is present), append a "copy this link" fallback under the button. */
  showLinkFallback?: boolean;
  /** Raw HTML for the footer region (rendered under a hairline divider). */
  footerHtml?: string;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildSystemEmail(opts: SystemEmailOptions): string {
  const accent   = (opts.accentColor || '#1b1b1b').trim() || '#1b1b1b';
  const logoUrl  = opts.logoUrl && opts.logoUrl.trim().length > 0 ? opts.logoUrl.trim() : null;
  const logoAlt  = opts.logoAlt || 'StoryVenue';
  const title    = opts.title || 'StoryVenue';

  // Always render a real logo image — never a text-based logo. Use the venue's
  // uploaded logo when provided, otherwise fall back to the black StoryVenue mark.
  const logoHtml = logoUrl
    ? `<img src="${escapeAttr(logoUrl)}" alt="${escapeAttr(logoAlt)}" style="display:inline-block;max-height:44px;max-width:200px;width:auto;height:auto;border:0;outline:none;text-decoration:none;">`
    : `<img src="${escapeAttr(STORYVENUE_DARK_LOGO_URL)}" alt="StoryVenue" height="30" style="display:inline-block;height:30px;width:auto;border:0;outline:none;text-decoration:none;">`;

  const headingLines = opts.heading
    ? (Array.isArray(opts.heading) ? opts.heading : [opts.heading])
    : [];
  const headingHtml = headingLines.length
    ? `<tr><td style="padding:20px 28px 0;text-align:center;">
          ${headingLines
            .map(line => `<p style="margin:0;font-size:18px;font-weight:700;color:#1b1b1b;line-height:1.4;">${line}</p>`)
            .join('\n          ')}
        </td></tr>`
    : '';

  const ctaHtml = opts.cta
    ? `<tr><td style="padding:28px 28px 0;text-align:center;">
          <a href="${escapeAttr(opts.cta.url)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:8px;font-size:14px;font-weight:600;">${opts.cta.label}</a>
          ${opts.showLinkFallback && opts.cta.url && opts.cta.url !== '#'
            ? `<p style="margin:12px 0 0;font-size:12px;color:#9ca3af;line-height:1.55;">If the button doesn&apos;t work, copy this link:<br><a href="${escapeAttr(opts.cta.url)}" style="color:${accent};text-decoration:underline;word-break:break-all;">${opts.cta.url}</a></p>`
            : ''}
        </td></tr>`
    : '';

  const footerHtml = opts.footerHtml
    ? `<tr><td style="padding:20px 28px 32px;">
          <div style="height:1px;background:#e5e7eb;margin-bottom:16px;"></div>
          ${opts.footerHtml}
        </td></tr>`
    : `<tr><td style="height:32px;line-height:32px;font-size:0;">&nbsp;</td></tr>`;

  const preheaderHtml = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${opts.preheader}</div>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f2f2f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preheaderHtml}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">

        <!-- Logo -->
        <tr><td style="padding:36px 28px 0;text-align:center;">${logoHtml}</td></tr>

        <!-- Heading -->
        ${headingHtml}

        <!-- Body -->
        <tr><td style="padding:24px 28px 0;">${opts.bodyHtml}</td></tr>

        <!-- CTA -->
        ${ctaHtml}

        <!-- Footer -->
        ${footerHtml}

      </table>
    </td></tr>
  </table>
</body></html>`;
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

  const linkUrl = actionUrl && actionUrl !== '#' ? actionUrl : null;

  // Convert plain-text body (blank lines → spacing) to paragraphs.
  const bodyHtml = body
    .split('\n')
    .map(line => line.trim() === ''
      ? '<div style="height:10px"></div>'
      : `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 4px;">${line}</p>`)
    .join('\n');

  const footerBits: string[] = [];
  if (footer) {
    footerBits.push(`<p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.55;text-align:center;">${footer}</p>`);
  }
  footerBits.push(`<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.55;text-align:center;">Sent via StoryVenue on behalf of ${venueName}</p>`);

  return buildSystemEmail({
    logoUrl,
    logoAlt:     venueName,
    brandName:   venueName,
    accentColor: brandColor,
    title:       heading,
    heading,
    bodyHtml,
    cta:         btnText ? { label: btnText, url: linkUrl ?? '#' } : undefined,
    showLinkFallback: !!linkUrl,
    footerHtml:  footerBits.join('\n'),
  });
}
