/**
 * Centralised "notify the venue owner" helper for payment-related events.
 *
 * Loads the venue's `venue_notifications.settings` toggle bag and the
 * `venues` row (branding + GHL creds + notification phone) once, then sends:
 *   - a branded owner-side email via `getVenueEmailTemplate(venueId, 'payment_notification')`
 *     (or a per-scenario fallback subject/body) when the matching `email_*` toggle is on
 *   - an SMS to `venues.notification_phone` via GHL when the matching `sms_*` toggle is on
 *
 * All sends are best-effort: errors are logged but never thrown, so the
 * caller's primary flow (e.g. payment verification) is never blocked.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { getVenueEmailTemplate, buildEmailHtml, fillTemplate } from '@/lib/email-templates';
import { findOrCreateContact, getGhlToken, normalizePhone, sendSms } from '@/lib/ghl';

export type OwnerScenario =
  | 'payment_received'
  | 'payment_failed'
  | 'high_value_payment'
  | 'proposal_signed'
  | 'document_viewed'
  | 'subscription_created'
  | 'subscription_cancelled'
  | 'invoice_paid'
  | 'refund_issued'
  | 'new_customer';

interface VenueRow {
  id: string;
  name: string | null;
  email: string | null;
  notification_phone: string | null;
  ghl_access_token: string | null;
  ghl_location_id: string | null;
  brand_color: string | null;
  brand_logo_url: string | null;
}

interface NotificationSettings {
  [key: string]: boolean | undefined;
}

async function loadVenue(venueId: string): Promise<VenueRow | null> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select('id, name, email, notification_phone, ghl_access_token, ghl_location_id, brand_color, brand_logo_url')
    .eq('id', venueId)
    .maybeSingle();
  return (data as VenueRow | null) ?? null;
}

async function loadSettings(venueId: string): Promise<NotificationSettings> {
  const { data } = await supabaseAdmin
    .from('venue_notifications')
    .select('settings')
    .eq('venue_id', venueId)
    .maybeSingle();
  return ((data as { settings?: NotificationSettings } | null)?.settings ?? {}) as NotificationSettings;
}

/** Map scenario → toggle keys + sensible default texts. */
const SCENARIO_META: Record<OwnerScenario, {
  emailKey: string;
  smsKey: string;
  /** Email template slug to load. We reuse `payment_notification` for most owner alerts. */
  templateType: string;
  /** Used as the SMS body and as a fallback if the venue disabled the email template. */
  defaultSmsTemplate: string;
  defaultEmailSubject: string;
  defaultEmailHeading: string;
  defaultEmailBody: string;
}> = {
  payment_received: {
    emailKey: 'email_payment_received',
    smsKey:   'sms_payment_received',
    templateType: 'payment_notification',
    defaultSmsTemplate: '💰 Payment received: {{amount}} from {{customer_name}} — {{organization}}',
    defaultEmailSubject: 'Payment received: {{amount}} from {{customer_name}}',
    defaultEmailHeading: 'New Payment Received',
    defaultEmailBody:    'You\'ve received a new payment for {{organization}}.\n\nCustomer: {{customer_name}}\nAmount: {{amount}}',
  },
  payment_failed: {
    emailKey: 'email_payment_failed',
    smsKey:   'sms_payment_failed',
    templateType: 'payment_notification',
    defaultSmsTemplate: '⚠️ Payment failed: {{amount}} from {{customer_name}} — {{organization}}. Reason: {{reason}}',
    defaultEmailSubject: 'Payment failed: {{customer_name}} — {{amount}}',
    defaultEmailHeading: 'Payment Failed',
    defaultEmailBody:    'A payment attempt for {{organization}} did not complete.\n\nCustomer: {{customer_name}}\nAmount: {{amount}}\nReason: {{reason}}',
  },
  high_value_payment: {
    emailKey: 'email_payment_received',
    smsKey:   'sms_high_value_payment',
    templateType: 'payment_notification',
    defaultSmsTemplate: '🎉 High-value payment: {{amount}} from {{customer_name}} — {{organization}}',
    defaultEmailSubject: 'High-value payment received: {{amount}} from {{customer_name}}',
    defaultEmailHeading: 'High-Value Payment Received',
    defaultEmailBody:    'A high-value payment was received for {{organization}}.\n\nCustomer: {{customer_name}}\nAmount: {{amount}}',
  },
  proposal_signed: {
    emailKey: 'email_proposal_signed',
    smsKey:   'sms_proposal_signed',
    templateType: 'proposal_signed',
    defaultSmsTemplate: '✍️ Proposal signed by {{customer_name}} — {{organization}}',
    defaultEmailSubject: '{{customer_name}} signed a proposal — {{organization}}',
    defaultEmailHeading: 'Proposal Signed',
    defaultEmailBody:    '{{customer_name}} just signed a proposal with {{organization}}.\n\nAmount: {{amount}}\n\nReview the signed proposal and reach out to confirm next steps.',
  },
  document_viewed: {
    emailKey: 'email_document_viewed',
    smsKey:   'sms_payment_received', // reuse closest SMS toggle
    templateType: 'document_viewed',
    defaultSmsTemplate: '👀 {{customer_name}} just viewed their document — {{organization}}',
    defaultEmailSubject: '{{customer_name}} just viewed their document — {{organization}}',
    defaultEmailHeading: 'Document Viewed',
    defaultEmailBody:    'Good news — {{customer_name}} just opened their proposal or invoice from {{organization}}.\n\nNow is a great time to follow up if they have any questions.',
  },
  subscription_created: {
    emailKey: 'email_subscription_created',
    smsKey:   'sms_subscription_created',
    templateType: 'payment_notification',
    defaultSmsTemplate: '🔁 New subscription: {{customer_name}} — {{amount}} {{frequency}} — {{organization}}',
    defaultEmailSubject: 'New subscription: {{customer_name}}',
    defaultEmailHeading: 'New Subscription Created',
    defaultEmailBody:    'A new subscription started for {{organization}}.\n\nCustomer: {{customer_name}}\nAmount: {{amount}} {{frequency}}',
  },
  subscription_cancelled: {
    emailKey: 'email_subscription_cancelled',
    smsKey:   'sms_subscription_created', // share the SMS toggle (no separate one yet)
    templateType: 'subscription_cancelled',
    defaultSmsTemplate: '🛑 Subscription cancelled: {{customer_name}} — {{organization}}',
    defaultEmailSubject: 'Subscription cancelled: {{customer_name}}',
    defaultEmailHeading: 'Subscription Cancelled',
    defaultEmailBody:    '{{customer_name}}\'s subscription with {{organization}} was cancelled.',
  },
  invoice_paid: {
    emailKey: 'email_invoice_paid',
    smsKey:   'sms_payment_received',
    templateType: 'payment_notification',
    defaultSmsTemplate: '💸 Invoice paid: {{amount}} from {{customer_name}} — {{organization}}',
    defaultEmailSubject: 'Invoice paid: {{amount}} from {{customer_name}}',
    defaultEmailHeading: 'Invoice Paid',
    defaultEmailBody:    'An invoice was just paid for {{organization}}.\n\nCustomer: {{customer_name}}\nAmount: {{amount}}',
  },
  refund_issued: {
    emailKey: 'email_refund_issued',
    smsKey:   'sms_payment_failed',
    templateType: 'payment_notification',
    defaultSmsTemplate: '↩️ Refund issued: {{amount}} to {{customer_name}} — {{organization}}',
    defaultEmailSubject: 'Refund issued to {{customer_name}}',
    defaultEmailHeading: 'Refund Issued',
    defaultEmailBody:    'A refund was issued for {{organization}}.\n\nCustomer: {{customer_name}}\nAmount: {{amount}}',
  },
  new_customer: {
    emailKey: 'email_new_customer',
    smsKey:   'sms_payment_received',
    templateType: 'payment_notification',
    defaultSmsTemplate: '👤 New customer: {{customer_name}} — {{organization}}',
    defaultEmailSubject: 'New customer: {{customer_name}}',
    defaultEmailHeading: 'New Customer',
    defaultEmailBody:    'A new customer was added to {{organization}}: {{customer_name}}.',
  },
};

/** Naive `{{key}}` interpolation that doesn't depend on the canonical merge-var resolver. */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, raw) => {
    const k = raw.trim();
    return vars[k] !== undefined ? vars[k] : '';
  });
}

interface NotifyArgs {
  venueId: string;
  scenario: OwnerScenario;
  vars: Record<string, string>;
  /** Optional URL for the email's CTA button. */
  actionUrl?: string;
  /** When true, also fires the `high_value_payment` SMS toggle if the amount qualifies. */
  alsoHighValue?: boolean;
}

/**
 * Send owner-side notifications (email + SMS) for a scenario, gated by the
 * venue's saved toggles. Best-effort — never throws.
 */
export async function notifyOwner(args: NotifyArgs): Promise<void> {
  try {
    const [venue, settings] = await Promise.all([loadVenue(args.venueId), loadSettings(args.venueId)]);
    if (!venue) return;
    const venueName = venue.name || 'Your Venue';
    const vars: Record<string, string> = {
      organization: venueName,
      ...args.vars,
    };

    const meta = SCENARIO_META[args.scenario];
    if (!meta) return;

    // ── Owner-side email ──────────────────────────────────────────────────
    // Gate 1: per-scenario notification toggle (settings[emailKey] defaults to true when unset).
    // Gate 2: the email template's own enabled flag — if the venue has disabled the
    //         template, getVenueEmailTemplate returns null and we skip the send entirely.
    const emailToggleOn = settings[meta.emailKey] !== false;
    if (emailToggleOn && venue.email) {
      try {
        const tmpl = await getVenueEmailTemplate(args.venueId, meta.templateType);
        if (!tmpl) {
          // Template disabled by the venue — honour their preference and skip.
          return;
        }
        await sendEmail({
          to:      venue.email,
          subject: fillTemplate(tmpl.subject, vars),
          html:    buildEmailHtml({
            template:   tmpl,
            vars,
            actionUrl:  args.actionUrl,
            brandColor: venue.brand_color   || '#1b1b1b',
            logoUrl:    venue.brand_logo_url || undefined,
            venueName,
          }),
        });
      } catch (err) {
        console.error('[notifyOwner email]', args.scenario, err instanceof Error ? err.message : err);
      }
    }

    // ── Owner-side SMS via GHL ────────────────────────────────────────────
    const smsEnabled = settings[meta.smsKey] === true
      || (args.alsoHighValue === true && settings.sms_high_value_payment === true && args.scenario !== 'high_value_payment');
    if (smsEnabled && venue.notification_phone) {
      try {
        const token = getGhlToken({ ghl_access_token: venue.ghl_access_token });
        const locId = venue.ghl_location_id || '';
        if (!token || !locId) {
          console.warn('[notifyOwner sms] missing GHL token/location for venue', args.venueId);
        } else {
          const norm = normalizePhone(venue.notification_phone) || venue.notification_phone;
          const contact = await findOrCreateContact(token, locId, {
            phone: norm,
            email: venue.email || undefined,
            firstName: 'Owner',
          }).catch(() => null);
          const contactId = (contact as { id?: string } | null)?.id;
          if (contactId) {
            const body = interpolate(meta.defaultSmsTemplate, vars);
            await sendSms(token, locId, contactId, body);
          }
        }
      } catch (err) {
        console.error('[notifyOwner sms]', args.scenario, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[notifyOwner]', args.scenario, err instanceof Error ? err.message : err);
  }
}

/** Convenience: format cents → "$X,XXX.XX". */
export function formatAmount(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

/** US$1,000 threshold for the "high-value" SMS — match the toggle copy. */
export const HIGH_VALUE_THRESHOLD_CENTS = 100_000;
