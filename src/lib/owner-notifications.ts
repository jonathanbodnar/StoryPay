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
import { sendNativePush } from '@/lib/native-push';
import { loadNotificationRecipients, emailKeyFor, smsKeyFor } from '@/lib/notification-settings';

export type OwnerScenario =
  | 'payment_received'
  | 'payment_failed'
  | 'proposal_signed'
  | 'document_viewed'
  | 'subscription_created'
  | 'refund_issued'
  // Scenarios used only for push (no email template by default). Phase 4
  // will wire these from the lead / conversations / AI-handoff flows.
  | 'new_lead'
  | 'new_message'
  | 'ai_handoff';
// `subscription_cancelled` / `invoice_paid` / `new_customer` were removed
// 2026-08-11 — defined here (and had matching toggles) but never actually
// fired: invoice payments already go through `payment_received`, there is
// no code path that cancels a customer's proposal subscription, and there
// is no "new customer" event distinct from `new_lead`. See
// src/lib/notification-settings.ts for the fuller note.

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
    defaultPushTitle: 'StoryVenue',
    defaultPushBody:  'Payment received: {{amount}} from {{customer_name}}',
    defaultPushUrl:   '/dashboard/transactions',
  },
  payment_failed: {
    emailKey: 'email_payment_failed',
    smsKey:   'sms_payment_failed',
    pushKey:  'push_payment_failed',
    // Dedicated owner-voice template, distinct from the customer-facing
    // `payment_failed` template (sent separately, straight to the customer,
    // from the checkout-decline handler in verify-payment/route.ts). These
    // used to share one template type, which meant the owner's alert email
    // was accidentally worded as if addressed to their customer.
    templateType: 'owner_payment_failed',
    defaultSmsTemplate: '⚠️ Payment failed: {{amount}} from {{customer_name}} — {{organization}}. Reason: {{reason}}',
    defaultEmailSubject: 'Payment failed: {{customer_name}} — {{amount}}',
    defaultEmailHeading: 'Payment Failed',
    defaultEmailBody:    'A payment attempt for {{organization}} did not complete.\n\nCustomer: {{customer_name}}\nAmount: {{amount}}\nReason: {{reason}}',
    defaultPushTitle: 'StoryVenue',
    defaultPushBody:  'Payment failed: {{amount}} from {{customer_name}} — {{reason}}',
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
    defaultPushTitle: 'StoryVenue',
    defaultPushBody:  'Proposal signed: {{customer_name}} signed for {{amount}}',
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
    defaultPushTitle: 'StoryVenue',
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
    defaultPushTitle: 'StoryVenue',
    defaultPushBody:  'New subscription: {{customer_name}} — {{amount}} {{frequency}}',
    defaultPushUrl:   '/dashboard/payments/subscriptions',
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
    defaultPushTitle: 'StoryVenue',
    defaultPushBody:  'Refund issued: {{amount}} refunded to {{customer_name}}',
    defaultPushUrl:   '/dashboard/transactions',
  },
  // ── Lead / conversation / AI-handoff scenarios ────────────────────────────
  new_lead: {
    emailKey: 'email_new_lead',
    smsKey:   'sms_new_lead',
    pushKey:  'push_new_lead',
    templateType: 'new_lead',
    defaultSmsTemplate: '🔔 New lead: {{customer_name}} — {{organization}}',
    defaultEmailSubject: 'New lead: {{customer_name}} — {{organization}}',
    defaultEmailHeading: 'New Lead',
    defaultEmailBody:    'A new lead came in for {{organization}}: {{customer_name}}.',
    defaultPushTitle: 'StoryVenue',
    defaultPushBody:  'New lead: {{customer_name}} just enquired',
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
    defaultPushTitle: 'StoryVenue',
    defaultPushBody:  '{{customer_name}}: {{message_preview}}',
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
    defaultPushTitle: 'StoryVenue',
    defaultPushBody:  'AI handoff: {{customer_name}} needs a human — {{reason}}',
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

    // ── Recipients: the owner + every active team member, each with their ──
    // own independent email_<scenario>/sms_<scenario> toggles (see
    // src/lib/notification-settings.ts).
    const emailKey = emailKeyFor(args.scenario);
    const smsKey   = smsKeyFor(args.scenario);
    const recipients = await loadNotificationRecipients(args.venueId);

    // ── Owner/team email ──────────────────────────────────────────────────
    // Gate 1: this person's own toggle (defaults applied in loadNotificationRecipients).
    // Gate 2: the email template's own enabled flag — if the venue has disabled the
    //         template, getVenueEmailTemplate returns null and we skip the email send
    //         entirely (template content/on-off is venue-wide, only the recipient
    //         list + per-recipient channel choice is per-person).
    const emailRecipients = recipients.filter(r => r.email && r.settings[emailKey] === true);
    if (emailRecipients.length === 0) {
      console.log('[notifyOwner]', args.scenario, 'no recipients with', emailKey, 'enabled');
    } else {
      try {
        const tmpl = await getVenueEmailTemplate(args.venueId, meta.templateType);
        if (!tmpl) {
          console.log('[notifyOwner]', args.scenario, 'template disabled or missing:', meta.templateType);
        } else {
          const subject = fillTemplate(tmpl.subject, vars);
          const html = buildEmailHtml({
            template:   tmpl,
            vars,
            actionUrl:  args.actionUrl,
            brandColor: venue.brand_color   || '#1b1b1b',
            logoUrl:    venue.brand_logo_url || undefined,
            venueName,
          });
          const results = await Promise.allSettled(
            emailRecipients.map(r => sendEmail({ to: r.email as string, subject, html })),
          );
          for (let i = 0; i < results.length; i++) {
            const res = results[i];
            const to = emailRecipients[i].email;
            if (res.status === 'fulfilled' && res.value.success) {
              console.log('[notifyOwner]', args.scenario, 'email sent to', to);
            } else {
              console.error('[notifyOwner]', args.scenario, 'email send failed:', to, res.status === 'fulfilled' ? res.value.error : res.reason);
            }
          }
        }
      } catch (err) {
        console.error('[notifyOwner email]', args.scenario, err instanceof Error ? err.message : err);
      }
    }

    // ── Owner/team SMS via GHL ─────────────────────────────────────────────
    const smsRecipients = recipients.filter(r => r.phone && r.settings[smsKey] === true);
    if (smsRecipients.length > 0) {
      const token = getGhlToken({ ghl_access_token: venue.ghl_access_token });
      const locId = venue.ghl_location_id || '';
      if (!token || !locId) {
        console.warn('[notifyOwner sms] missing GHL token/location for venue', args.venueId);
      } else {
        const body = interpolate(meta.defaultSmsTemplate, vars);
        const results = await Promise.allSettled(smsRecipients.map(async r => {
          const norm = normalizePhone(r.phone) || r.phone;
          const contact = await findOrCreateContact(token, locId, {
            phone: norm ?? undefined,
            email: r.email || undefined,
            firstName: r.name || (r.kind === 'owner' ? 'Owner' : undefined),
          }).catch(() => null);
          const contactId = (contact as { id?: string } | null)?.id;
          if (contactId) await sendSms(token, locId, contactId, body);
        }));
        for (const res of results) {
          if (res.status === 'rejected') console.error('[notifyOwner sms]', args.scenario, res.reason);
        }
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
        // Fire web-push (browsers / installed PWAs) and native push (Capacitor
        // iOS/Android shell) from the SAME gated point so every device a user
        // is signed in on gets the alert. Both are best-effort and independent
        // — one being unconfigured never blocks the other.
        const [result, nativeResult] = await Promise.all([
          sendPushToVenue(args.venueId, {
            title,
            body,
            url,
            tag:  `${args.scenario}-${args.venueId}`,
          }),
          sendNativePush(args.venueId, {
            title,
            body,
            url,
            data: { scenario: args.scenario, venueId: args.venueId },
          }),
        ]);
        if (result.sent > 0 || result.pruned > 0) {
          console.log('[notifyOwner]', args.scenario, 'push', result);
        }
        if (nativeResult.sent > 0 || nativeResult.pruned > 0) {
          console.log('[notifyOwner]', args.scenario, 'native-push', nativeResult);
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

// ── Convenience wrappers for the push-first scenarios ───────────────────────
// These exist so the lead-creation, inbound-message, and AI-handoff call
// sites can stay one-liners without re-deriving the merge variables and
// dashboard URLs every time.

/** Fire a "new lead" push for the freshly-inserted lead. */
export function notifyOwnerNewLead(input: {
  venueId: string;
  leadId: string;
  fullName: string;
  email: string;
  phone?: string | null;
  source?: string | null;
  createdAt?: string | null;
}): void {
  const display = (input.fullName || '').trim() || input.email || 'New lead';
  void notifyOwner({
    venueId:   input.venueId,
    scenario:  'new_lead',
    vars: {
      customer_name: display,
      email:         input.email || '',
      source:        input.source || 'directory',
    },
    actionUrl: `/dashboard/contacts/${input.leadId}`,
  });
}

/** Fire a "new message" push for an inbound conversation message. */
export function notifyOwnerNewMessage(input: {
  venueId: string;
  threadId: string;
  fromName: string | null;
  fromEmail: string;
  bodyText: string;
  /** venue_customers UUID — used to resolve the contact's name from our DB
   *  when the caller doesn't have a display name (e.g. a GHL contact with
   *  no firstName/lastName set). */
  venueCustomerId?: string | null;
}): void {
  // Trim aggressively — the lock screen typically shows ~60 chars before
  // truncating, so keep the preview punchy.
  const preview = input.bodyText.replace(/\s+/g, ' ').slice(0, 140);

  void (async () => {
    let display = (input.fromName || '').trim() || input.fromEmail.trim() || '';

    // If we still don't have a name, try to resolve it from venue_customers.
    if (!display && input.venueCustomerId) {
      try {
        const { supabaseAdmin } = await import('@/lib/supabase');
        const { data: row } = await supabaseAdmin
          .from('venue_customers')
          .select('first_name, last_name, customer_email')
          .eq('id', input.venueCustomerId)
          .maybeSingle();
        if (row) {
          const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
          display = fullName || (row.customer_email as string | null) || '';
        }
      } catch { /* best-effort — never block the notification */ }
    }

    if (!display) display = 'Someone';

    await notifyOwner({
      venueId:   input.venueId,
      scenario:  'new_message',
      vars: {
        customer_name:   display,
        message_preview: preview,
      },
      actionUrl: `/dashboard/conversations?thread=${input.threadId}`,
    });
  })();
}

/** Fire an "AI Concierge handed off to you" push. */
export function notifyOwnerAiHandoff(input: {
  venueId: string;
  leadId: string;
  brideName: string;
  reason: string;
}): void {
  void notifyOwner({
    venueId:   input.venueId,
    scenario:  'ai_handoff',
    vars: {
      customer_name: input.brideName || 'Your contact',
      reason:        input.reason || 'needs human follow-up',
    },
    actionUrl: `/dashboard/contacts/${input.leadId}`,
  });
}

/**
 * Fire a PUSH-ONLY alert when the StoryVenue Concierge team sends a Venue
 * Direct message to a venue.
 *
 * Email + SMS for Venue Direct are handled inline in the venue-direct route
 * (they honour each recipient's per-person email_venue_direct /
 * sms_venue_direct prefs), so this deliberately sends ONLY web + native push
 * so the mobile app both alerts and updates its badge. Push toggles are
 * venue-wide, so we gate on the master `push_enabled` toggle only (always-on
 * for this alert once push is enabled, like the other first-class signals).
 */
export async function notifyOwnerVenueDirectPush(input: {
  venueId: string;
  venueCustomerId: string;
}): Promise<void> {
  try {
    const settings = await loadSettings(input.venueId);
    if (settings.push_enabled !== true) return;
    const title = 'StoryVenue';
    const body  = 'You have a new message from the StoryVenue Concierge team.';
    const url   = `/dashboard/contacts/${input.venueCustomerId}?tab=concierge`;
    const [result, nativeResult] = await Promise.all([
      sendPushToVenue(input.venueId, {
        title,
        body,
        url,
        tag: `venue_direct-${input.venueId}`,
      }),
      sendNativePush(input.venueId, {
        title,
        body,
        url,
        data: { scenario: 'venue_direct', venueId: input.venueId },
      }),
    ]);
    if (result.sent > 0 || result.pruned > 0) {
      console.log('[notifyOwnerVenueDirectPush] push', result);
    }
    if (nativeResult.sent > 0 || nativeResult.pruned > 0) {
      console.log('[notifyOwnerVenueDirectPush] native-push', nativeResult);
    }
  } catch (err) {
    console.error('[notifyOwnerVenueDirectPush]', err instanceof Error ? err.message : err);
  }
}
