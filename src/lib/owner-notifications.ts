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
import { sendPushToVenue } from '@/lib/push';

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
  | 'new_customer'
  // Scenarios used only for push (no email template by default). Phase 4
  // will wire these from the lead / conversations / AI-handoff flows.
  | 'new_lead'
  | 'new_message'
  | 'ai_handoff';

interface VenueRow {
  id: string;
  name: string | null;
  email: string | null;
  notification_email: string | null;
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
  // First attempt: the canonical column set. If any column is missing in this
  // environment (e.g. the schema is out of date), Supabase returns an error
  // and the entire query fails — which silently broke owner notifications
  // for an extended period. Fall back to a slim safe set on error so
  // notifications keep firing.
  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, email, notification_email, notification_phone, ghl_access_token, ghl_location_id, brand_color, brand_logo_url')
    .eq('id', venueId)
    .maybeSingle();

  if (error) {
    console.warn('[notifyOwner loadVenue] full-column query failed:', error.message, '— retrying with slim column set');
    const { data: slim, error: slimErr } = await supabaseAdmin
      .from('venues')
      .select('id, name, email, brand_color, brand_logo_url')
      .eq('id', venueId)
      .maybeSingle();
    if (slimErr || !slim) {
      console.error('[notifyOwner loadVenue] slim query also failed:', slimErr?.message);
      return null;
    }
    // Synthesize the optional columns as null — owner SMS will be skipped,
    // but the email path keeps working off `email`.
    return {
      ...(slim as Omit<VenueRow, 'notification_email' | 'notification_phone' | 'ghl_access_token' | 'ghl_location_id'>),
      notification_email: null,
      notification_phone: null,
      ghl_access_token:   null,
      ghl_location_id:    null,
    };
  }

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
  /** Per-scenario push toggle. When undefined, push is sent unconditionally
   *  (gated only by the master `push_enabled` toggle). */
  pushKey?: string;
  /** Email template slug to load. We reuse `payment_notification` for most owner alerts. */
  templateType: string;
  /** Used as the SMS body and as a fallback if the venue disabled the email template. */
  defaultSmsTemplate: string;
  defaultEmailSubject: string;
  defaultEmailHeading: string;
  defaultEmailBody: string;
  /** Push title — bold first line on the lock screen. Supports `{{vars}}`. */
  defaultPushTitle: string;
  /** Push body — secondary line. Supports `{{vars}}`. */
  defaultPushBody: string;
  /** Path the SW opens on click. May be omitted for "open dashboard root". */
  defaultPushUrl?: string;
}> = {
  payment_received: {
    emailKey: 'email_payment_received',
    smsKey:   'sms_payment_received',
    pushKey:  'push_payment_received',
    templateType: 'payment_notification',
    defaultSmsTemplate: '💰 Payment received: {{amount}} from {{customer_name}} — {{organization}}',
    defaultEmailSubject: 'Payment received: {{amount}} from {{customer_name}}',
    defaultEmailHeading: 'New Payment Received',
    defaultEmailBody:    'You\'ve received a new payment for {{organization}}.\n\nCustomer: {{customer_name}}\nAmount: {{amount}}',
    defaultPushTitle: 'Payment received',
    defaultPushBody:  '{{amount}} from {{customer_name}}',
    defaultPushUrl:   '/dashboard/transactions',
  },
  payment_failed: {
    emailKey: 'email_payment_failed',
    smsKey:   'sms_payment_failed',
    pushKey:  'push_payment_failed',
    templateType: 'payment_failed',
    defaultSmsTemplate: '⚠️ Payment failed: {{amount}} from {{customer_name}} — {{organization}}. Reason: {{reason}}',
    defaultEmailSubject: 'Payment failed: {{customer_name}} — {{amount}}',
    defaultEmailHeading: 'Payment Failed',
    defaultEmailBody:    'A payment attempt for {{organization}} did not complete.\n\nCustomer: {{customer_name}}\nAmount: {{amount}}\nReason: {{reason}}',
    defaultPushTitle: 'Payment failed',
    defaultPushBody:  '{{amount}} from {{customer_name}} — {{reason}}',
    defaultPushUrl:   '/dashboard/transactions',
  },
  high_value_payment: {
    emailKey: 'email_payment_received',
    smsKey:   'sms_high_value_payment',
    pushKey:  'push_high_value_payment',
    templateType: 'payment_notification',
    defaultSmsTemplate: '🎉 High-value payment: {{amount}} from {{customer_name}} — {{organization}}',
    defaultEmailSubject: 'High-value payment received: {{amount}} from {{customer_name}}',
    defaultEmailHeading: 'High-Value Payment Received',
    defaultEmailBody:    'A high-value payment was received for {{organization}}.\n\nCustomer: {{customer_name}}\nAmount: {{amount}}',
    defaultPushTitle: '🎉 High-value payment',
    defaultPushBody:  '{{amount}} from {{customer_name}}',
    defaultPushUrl:   '/dashboard/transactions',
  },
  proposal_signed: {
    emailKey: 'email_proposal_signed',
    smsKey:   'sms_proposal_signed',
    pushKey:  'push_proposal_signed',
    templateType: 'proposal_signed',
    defaultSmsTemplate: '✍️ Proposal signed by {{customer_name}} — {{organization}}',
    defaultEmailSubject: '{{customer_name}} signed a proposal — {{organization}}',
    defaultEmailHeading: 'Proposal Signed',
    defaultEmailBody:    '{{customer_name}} just signed a proposal with {{organization}}.\n\nAmount: {{amount}}\n\nReview the signed proposal and reach out to confirm next steps.',
    defaultPushTitle: 'Proposal signed',
    defaultPushBody:  '{{customer_name}} signed for {{amount}}',
    defaultPushUrl:   '/dashboard/payments/proposals',
  },
  document_viewed: {
    emailKey: 'email_document_viewed',
    smsKey:   'sms_payment_received', // reuse closest SMS toggle
    pushKey:  'push_document_viewed',
    templateType: 'document_viewed',
    defaultSmsTemplate: '👀 {{customer_name}} just viewed their document — {{organization}}',
    defaultEmailSubject: '{{customer_name}} just viewed their document — {{organization}}',
    defaultEmailHeading: 'Document Viewed',
    defaultEmailBody:    'Good news — {{customer_name}} just opened their proposal or invoice from {{organization}}.\n\nNow is a great time to follow up if they have any questions.',
    defaultPushTitle: 'Document opened',
    defaultPushBody:  '{{customer_name}} is looking at your proposal',
    defaultPushUrl:   '/dashboard/payments/proposals',
  },
  subscription_created: {
    emailKey: 'email_subscription_created',
    smsKey:   'sms_subscription_created',
    pushKey:  'push_subscription_created',
    templateType: 'payment_notification',
    defaultSmsTemplate: '🔁 New subscription: {{customer_name}} — {{amount}} {{frequency}} — {{organization}}',
    defaultEmailSubject: 'New subscription: {{customer_name}}',
    defaultEmailHeading: 'New Subscription Created',
    defaultEmailBody:    'A new subscription started for {{organization}}.\n\nCustomer: {{customer_name}}\nAmount: {{amount}} {{frequency}}',
    defaultPushTitle: 'New subscription',
    defaultPushBody:  '{{customer_name}} — {{amount}} {{frequency}}',
    defaultPushUrl:   '/dashboard/payments/subscriptions',
  },
  subscription_cancelled: {
    emailKey: 'email_subscription_cancelled',
    smsKey:   'sms_subscription_created', // share the SMS toggle (no separate one yet)
    pushKey:  'push_subscription_cancelled',
    templateType: 'subscription_cancelled',
    defaultSmsTemplate: '🛑 Subscription cancelled: {{customer_name}} — {{organization}}',
    defaultEmailSubject: 'Subscription cancelled: {{customer_name}}',
    defaultEmailHeading: 'Subscription Cancelled',
    defaultEmailBody:    '{{customer_name}}\'s subscription with {{organization}} was cancelled.',
    defaultPushTitle: 'Subscription cancelled',
    defaultPushBody:  '{{customer_name}} cancelled their subscription',
    defaultPushUrl:   '/dashboard/payments/subscriptions',
  },
  invoice_paid: {
    emailKey: 'email_invoice_paid',
    smsKey:   'sms_payment_received',
    pushKey:  'push_invoice_paid',
    templateType: 'payment_notification',
    defaultSmsTemplate: '💸 Invoice paid: {{amount}} from {{customer_name}} — {{organization}}',
    defaultEmailSubject: 'Invoice paid: {{amount}} from {{customer_name}}',
    defaultEmailHeading: 'Invoice Paid',
    defaultEmailBody:    'An invoice was just paid for {{organization}}.\n\nCustomer: {{customer_name}}\nAmount: {{amount}}',
    defaultPushTitle: 'Invoice paid',
    defaultPushBody:  '{{amount}} from {{customer_name}}',
    defaultPushUrl:   '/dashboard/invoices',
  },
  refund_issued: {
    emailKey: 'email_refund_issued',
    smsKey:   'sms_payment_failed',
    pushKey:  'push_refund_issued',
    templateType: 'payment_notification',
    defaultSmsTemplate: '↩️ Refund issued: {{amount}} to {{customer_name}} — {{organization}}',
    defaultEmailSubject: 'Refund issued to {{customer_name}}',
    defaultEmailHeading: 'Refund Issued',
    defaultEmailBody:    'A refund was issued for {{organization}}.\n\nCustomer: {{customer_name}}\nAmount: {{amount}}',
    defaultPushTitle: 'Refund issued',
    defaultPushBody:  '{{amount}} refunded to {{customer_name}}',
    defaultPushUrl:   '/dashboard/transactions',
  },
  new_customer: {
    emailKey: 'email_new_customer',
    smsKey:   'sms_payment_received',
    pushKey:  'push_new_customer',
    templateType: 'payment_notification',
    defaultSmsTemplate: '👤 New customer: {{customer_name}} — {{organization}}',
    defaultEmailSubject: 'New customer: {{customer_name}}',
    defaultEmailHeading: 'New Customer',
    defaultEmailBody:    'A new customer was added to {{organization}}: {{customer_name}}.',
    defaultPushTitle: 'New customer',
    defaultPushBody:  '{{customer_name}}',
    defaultPushUrl:   '/dashboard/contacts',
  },
  // ── Push-first scenarios (no email/SMS by default) ────────────────────────
  // These reuse no email template — push is the only channel. Phase 4 will
  // wire each from its origin (lead creation, inbound conversation, AI
  // handoff). Until wired, calling notifyOwner({scenario:'new_lead'}) is a
  // safe no-op (no recipient email, push toggle off by default).
  new_lead: {
    emailKey: 'email_new_lead',
    smsKey:   'sms_new_lead',
    pushKey:  'push_new_lead',
    templateType: 'new_lead',
    defaultSmsTemplate: '🔔 New lead: {{customer_name}} — {{organization}}',
    defaultEmailSubject: 'New lead: {{customer_name}} — {{organization}}',
    defaultEmailHeading: 'New Lead',
    defaultEmailBody:    'A new lead came in for {{organization}}: {{customer_name}}.',
    defaultPushTitle: 'New lead',
    defaultPushBody:  '{{customer_name}} just enquired',
    defaultPushUrl:   '/dashboard/leads',
  },
  new_message: {
    emailKey: 'email_new_message',
    smsKey:   'sms_new_message',
    pushKey:  'push_new_message',
    templateType: 'new_message',
    defaultSmsTemplate: '💬 {{customer_name}} replied — {{organization}}',
    defaultEmailSubject: '{{customer_name}} replied — {{organization}}',
    defaultEmailHeading: 'New Message',
    defaultEmailBody:    '{{customer_name}} replied to a conversation with {{organization}}.',
    defaultPushTitle: '{{customer_name}}',
    defaultPushBody:  '{{message_preview}}',
    defaultPushUrl:   '/dashboard/conversations',
  },
  ai_handoff: {
    emailKey: 'email_ai_handoff',
    smsKey:   'sms_ai_handoff',
    pushKey:  'push_ai_handoff',
    templateType: 'ai_handoff',
    defaultSmsTemplate: '🤖 AI Concierge handed off: {{customer_name}} needs you — {{organization}}',
    defaultEmailSubject: 'AI Concierge handoff: {{customer_name}}',
    defaultEmailHeading: 'AI Concierge Handoff',
    defaultEmailBody:    'The AI Concierge handed off the conversation with {{customer_name}} to you. Reason: {{reason}}',
    defaultPushTitle: 'AI handed off to you',
    defaultPushBody:  '{{customer_name}} needs a human — {{reason}}',
    defaultPushUrl:   '/dashboard/conversations',
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
 *
 * Logs every decision (toggle off, no recipient, template disabled, send result)
 * so production logs make it obvious *why* an expected email didn't go out.
 */
export async function notifyOwner(args: NotifyArgs): Promise<void> {
  console.log('[notifyOwner]', args.scenario, 'invoked for venue', args.venueId);
  try {
    const [venue, settings] = await Promise.all([loadVenue(args.venueId), loadSettings(args.venueId)]);
    if (!venue) {
      console.warn('[notifyOwner]', args.scenario, 'no venue row for', args.venueId, '— check that the venues query columns match the production schema');
      return;
    }
    console.log('[notifyOwner]', args.scenario, 'venue loaded', {
      id: venue.id,
      hasNotificationEmail: !!venue.notification_email,
      hasEmail: !!venue.email,
      hasNotificationPhone: !!venue.notification_phone,
    });
    const venueName = venue.name || 'Your Venue';
    const vars: Record<string, string> = {
      organization: venueName,
      ...args.vars,
    };

    const meta = SCENARIO_META[args.scenario];
    if (!meta) {
      console.warn('[notifyOwner]', args.scenario, 'no scenario meta');
      return;
    }

    // ── Owner-side email ──────────────────────────────────────────────────
    // Gate 1: per-scenario notification toggle (settings[emailKey] defaults to true when unset).
    // Gate 2: the email template's own enabled flag — if the venue has disabled the
    //         template, getVenueEmailTemplate returns null and we skip the email send.
    //
    // Recipient: prefer notification_email (set in venue settings) and fall
    // back to email (account email). Both fields live on the venues row.
    const recipientEmail = venue.notification_email || venue.email;
    const emailToggleOn = settings[meta.emailKey] !== false;

    if (!emailToggleOn) {
      console.log('[notifyOwner]', args.scenario, 'email toggle off:', meta.emailKey);
    } else if (!recipientEmail) {
      console.warn('[notifyOwner]', args.scenario, 'no recipient email (notification_email and email are both blank) for venue', args.venueId);
    } else {
      try {
        const tmpl = await getVenueEmailTemplate(args.venueId, meta.templateType);
        if (!tmpl) {
          console.log('[notifyOwner]', args.scenario, 'template disabled or missing:', meta.templateType);
        } else {
          const result = await sendEmail({
            to:      recipientEmail,
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
          if (result.success) {
            console.log('[notifyOwner]', args.scenario, 'email sent to', recipientEmail);
          } else {
            console.error('[notifyOwner]', args.scenario, 'email send failed:', result.error);
          }
        }
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

    // ── Owner-side push (Web Push API) ────────────────────────────────────
    // Two gates:
    //   1. The master `push_enabled` toggle (default false). Users have to
    //      actively opt in by enabling push in Settings → Notifications.
    //      Without this gate, every install would receive push the moment a
    //      subscription is saved, before the user has a chance to disable
    //      categories they don't care about.
    //   2. The per-scenario `push_<scenario>` toggle. We default these to
    //      true for the loud signals (payment, signed proposal, new lead,
    //      new message, AI handoff) and false for the quieter ones (new
    //      customer, document_viewed). See DEFAULT_NOTIFICATIONS.
    const masterPushOn = settings.push_enabled === true;
    const scenarioPushOn =
      !meta.pushKey                            // legacy entries without pushKey: always on
        ? true
        : settings[meta.pushKey] !== false;    // unset → true (use defaults)
    if (masterPushOn && scenarioPushOn) {
      try {
        const title = interpolate(meta.defaultPushTitle, vars);
        const body  = interpolate(meta.defaultPushBody,  vars);
        const url   = args.actionUrl || meta.defaultPushUrl;
        const result = await sendPushToVenue(args.venueId, {
          title,
          body,
          url,
          tag:  `${args.scenario}-${args.venueId}`,
        });
        if (result.sent > 0 || result.pruned > 0) {
          console.log('[notifyOwner]', args.scenario, 'push', result);
        }
      } catch (err) {
        console.error('[notifyOwner push]', args.scenario, err instanceof Error ? err.message : err);
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
