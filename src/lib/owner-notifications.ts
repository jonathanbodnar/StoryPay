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
import type { EmailTemplateRow } from '@/lib/email-templates';
import { SYSTEM_EMAIL_BY_KEY } from '@/lib/system-email-registry';
import { findOrCreateContact, getGhlToken, normalizePhone, sendSms } from '@/lib/ghl';
import { sendPushToVenue } from '@/lib/push';
import { sendNativePush } from '@/lib/native-push';
import { loadNotificationRecipients, emailKeyFor, smsKeyFor } from '@/lib/notification-settings';
import { buildOwnerReplyToEmail, buildVenueConciergeReplyToEmail } from '@/lib/conversations-inbound-email';
import { bucketLeadSource, leadSourceLabel } from '@/lib/lead-source';
import { venueTimeZoneFromLocation, type VenueTimeZoneFields } from '@/lib/venue-zip-timezone';

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
    // Push-only channel that venue owners actually see (see comment on
    // notifyOwnerAiHandoff below) — kept AI-free, unlike the vestigial
    // email/SMS copy above which is unreachable dead config.
    defaultPushBody:  'Your StoryVenue Concierge Team needs you: {{customer_name}} — {{reason}}',
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
  /** Conversation thread this notification is about. When present, the owner
   *  email gets a Reply-To that routes a reply straight to the contact in the
   *  thread (see buildOwnerReplyToEmail / the inbound-email webhook). */
  threadId?: string;
  /** Ready-made HTML placed under the template body (the new-lead details table). */
  extraHtml?: string;
  /** Reply-To for the email, e.g. the couple's address so "Reply" writes to them. */
  replyTo?: string;
  /**
   * More addresses that get the same email regardless of the per-person
   * toggles — a builder form's own "notification emails" list. Addresses that
   * are already recipients are not emailed twice.
   */
  extraEmailRecipients?: string[];
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
    const toggledOn = recipients
      .filter(r => r.email && r.settings[emailKey] === true)
      .map(r => (r.email as string).trim());
    const seen = new Set(recipients.map(r => (r.email ?? '').trim().toLowerCase()).filter(Boolean));
    const extra: string[] = [];
    for (const raw of args.extraEmailRecipients ?? []) {
      const e = raw.trim();
      if (!e || seen.has(e.toLowerCase())) continue;
      seen.add(e.toLowerCase());
      extra.push(e);
    }
    const emailRecipients = [...toggledOn, ...extra];
    if (emailRecipients.length === 0) {
      console.log('[notifyOwner]', args.scenario, 'no recipients with', emailKey, 'enabled');
    } else {
      try {
        const tmpl = await getVenueEmailTemplate(args.venueId, meta.templateType);
        if (!tmpl) {
          console.log('[notifyOwner]', args.scenario, 'template disabled or missing:', meta.templateType);
        } else {
          // CTA links must be absolute to work from an email client.
          const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');
          const absActionUrl = args.actionUrl
            ? (/^https?:\/\//i.test(args.actionUrl) ? args.actionUrl : `${appUrl}${args.actionUrl}`)
            : undefined;

          // Reply-To routing. For a conversation notification, a reply from the
          // owner's inbox is sent to the contact in-thread. For everything else
          // we fall back to a monitored/owner address so a reply NEVER bounces
          // off the send-only notifications mailbox.
          const threadReplyTo = args.threadId ? buildOwnerReplyToEmail(args.threadId, args.venueId) : null;
          const fallbackReplyTo = process.env.NOTIFICATION_REPLY_TO?.trim() || venue.email || undefined;
          const effectiveReplyTo = args.replyTo || threadReplyTo || fallbackReplyTo || undefined;

          // Template copy uses {{reply_hint}} to explain what a reply will do —
          // only promise the auto-send when routing is actually available.
          if (vars.reply_hint === undefined) {
            vars.reply_hint = threadReplyTo
              ? `Reply directly to this email and your response is sent to ${vars.customer_name || 'them'} in the conversation automatically — or log in on desktop or in the app to reply from there.`
              : 'Log in on desktop or in the app to reply.';
          }

          const subject = fillTemplate(tmpl.subject, vars);
          // The new-lead alert is a StoryVenue notification: always the
          // StoryVenue dark logo and #1b1b1b, whatever the venue's branding.
          const storyVenueLook = args.scenario === 'new_lead';
          const html = buildEmailHtml({
            template:   tmpl,
            vars,
            actionUrl:  absActionUrl,
            brandColor: storyVenueLook ? '#1b1b1b' : venue.brand_color || '#1b1b1b',
            logoUrl:    storyVenueLook ? undefined : venue.brand_logo_url || undefined,
            venueName,
            extraHtml:  args.extraHtml,
          });
          // Send from the dedicated notifications address so venue owners
          // see "StoryVenue" (not hello@) in their inbox.
          // Honour NOTIFICATION_FROM_EMAIL if configured on the host.
          const notifFromEmail =
            process.env.NOTIFICATION_FROM_EMAIL?.trim() || 'notifications@send.storyvenue.com';
          const results = await Promise.allSettled(
            emailRecipients.map(to => sendEmail({
              to,
              subject,
              html,
              replyTo: effectiveReplyTo,
              from: { email: notifFromEmail, name: 'StoryVenue' },
            })),
          );
          for (let i = 0; i < results.length; i++) {
            const res = results[i];
            const to = emailRecipients[i];
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

function escapeHtmlBasic(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Notify a venue that the StoryVenue Concierge team just sent them a message on
 * the Venue Concierge channel. Sends:
 *   - a concierge-voiced email (to owner + active team members) whose Reply-To
 *     routes a reply straight back into the concierge thread (vcreply+ inbound),
 *   - web + native push (gated on the master push_enabled toggle) so the mobile
 *     app alerts + badges like every other first-class signal.
 * Best-effort — never throws.
 */
export async function notifyVenueOfConciergeMessage(input: {
  venueId: string;
  authorName: string;
  bodyPreview: string;
}): Promise<void> {
  try {
    const [venue, settings] = await Promise.all([
      loadVenue(input.venueId),
      loadSettings(input.venueId),
    ]);
    if (!venue) return;
    const venueName = venue.name || 'your venue';
    const preview = input.bodyPreview.replace(/\s+/g, ' ').slice(0, 600);
    const author = (input.authorName || 'StoryVenue Concierge').trim();

    // ── Email ──────────────────────────────────────────────────────────────
    const toSet = new Set<string>();
    for (const e of [venue.notification_email, venue.email]) {
      if (e && e.trim()) toSet.add(e.trim().toLowerCase());
    }
    try {
      const { data: members } = await supabaseAdmin
        .from('venue_team_members')
        .select('email, status')
        .eq('venue_id', input.venueId);
      for (const m of (members ?? []) as Array<{ email: string | null; status: string | null }>) {
        if (m.email && m.status !== 'inactive') toSet.add(m.email.trim().toLowerCase());
      }
    } catch { /* best-effort */ }

    const recipients = Array.from(toSet);
    if (recipients.length > 0) {
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');
      const ctaUrl = `${appUrl}/dashboard/venue-concierge`;
      const replyTo =
        buildVenueConciergeReplyToEmail(input.venueId) ||
        process.env.NOTIFICATION_REPLY_TO?.trim() ||
        venue.email ||
        undefined;
      const canReply = !!buildVenueConciergeReplyToEmail(input.venueId);
      const replyHint = canReply
        ? 'Reply directly to this email and your message goes straight to your concierge — or open the Venue Concierge tab on desktop or in the app.'
        : 'Open the Venue Concierge tab on desktop or in the app to reply.';

      // Best-effort owner first name for the greeting.
      let ownerFirst = 'there';
      try {
        const { data: ownerRow } = await supabaseAdmin
          .from('venues')
          .select('owner_first_name')
          .eq('id', input.venueId)
          .maybeSingle();
        const n = (ownerRow as { owner_first_name?: string | null } | null)?.owner_first_name?.trim();
        if (n) ownerFirst = n;
      } catch { /* best-effort */ }

      // Render through the shared, brand-consistent system-email chassis. Copy
      // is editable in the super-admin System Emails panel
      // (key: venue_concierge_message) and falls back to the registry defaults.
      const def = SYSTEM_EMAIL_BY_KEY['venue_concierge_message']!;
      let subject     = def.defaults.subject;
      let heading     = def.defaults.heading;
      let bodyText    = def.defaults.body;
      let buttonText  = def.defaults.button_text ?? null;
      try {
        const { data: override } = await supabaseAdmin
          .from('system_email_templates')
          .select('subject, heading, body, button_text')
          .eq('key', 'venue_concierge_message')
          .maybeSingle();
        if (override) {
          const o = override as { subject?: string | null; heading?: string | null; body?: string | null; button_text?: string | null };
          subject    = o.subject    || subject;
          heading    = o.heading    || heading;
          bodyText   = o.body       || bodyText;
          buttonText = o.button_text !== undefined ? o.button_text : buttonText;
        }
      } catch { /* fall back to registry defaults */ }

      // Subject is plain text → raw vars. HTML body is injected unescaped by the
      // chassis, so escape any dynamic (user-authored) values first.
      const resolvedSubject = fillTemplate(subject, { venue_name: venueName, author_name: author });
      const htmlVars: Record<string, string> = {
        owner_first_name: escapeHtmlBasic(ownerFirst),
        author_name:      escapeHtmlBasic(author),
        venue_name:       escapeHtmlBasic(venueName),
        message_preview:  escapeHtmlBasic(preview),
        reply_hint:       escapeHtmlBasic(replyHint),
      };

      const tplRow: EmailTemplateRow = {
        type: 'venue_concierge_message',
        subject,
        heading,
        body: bodyText,
        button_text: buttonText,
        footer: null,
        enabled: true,
      };

      const html = buildEmailHtml({
        template:  tplRow,
        vars:      htmlVars,
        actionUrl: ctaUrl,
        brandColor: '#1b1b1b',
        venueName,
      });

      const notifFromEmail =
        process.env.NOTIFICATION_FROM_EMAIL?.trim() || 'notifications@send.storyvenue.com';
      await Promise.allSettled(
        recipients.map((to) =>
          sendEmail({
            to,
            subject: resolvedSubject,
            html,
            replyTo,
            from: { email: notifFromEmail, name: 'StoryVenue Concierge' },
          }),
        ),
      );
    }

    // ── Push (web + native), gated on the master push toggle ────────────────
    if (settings.push_enabled === true) {
      const title = 'StoryVenue Concierge';
      const body = `${author}: ${preview.slice(0, 120)}`;
      const url = '/dashboard/venue-concierge';
      await Promise.all([
        sendPushToVenue(input.venueId, { title, body, url, tag: `venue_concierge-${input.venueId}` }),
        sendNativePush(input.venueId, {
          title,
          body,
          url,
          data: { scenario: 'venue_concierge', venueId: input.venueId },
        }),
      ]);
    }
  } catch (err) {
    console.error('[notifyVenueOfConciergeMessage]', err instanceof Error ? err.message : err);
  }
}

/** "+14075550142" → "(407) 555-0142"; anything else is shown as given. */
function displayPhone(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  const us = /^\+?1?(\d{3})(\d{3})(\d{4})$/.exec(v.replace(/[^\d+]/g, ''));
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : v;
}

/**
 * When the lead came in, in the VENUE's local time (from its ZIP — see
 * lib/venue-zip-timezone), e.g. "Sep 24, 2026, 9:42 PM EDT". Falls back to UTC,
 * labelled as such, if the venue has no location at all.
 */
async function formatInVenueTime(venueId: string, iso: string | null | undefined): Promise<string> {
  const when = iso ? new Date(iso) : new Date();
  const at = Number.isNaN(when.getTime()) ? new Date() : when;
  let timeZone: string | undefined;
  try {
    const { data } = await supabaseAdmin.from('venues').select('*').eq('id', venueId).maybeSingle();
    timeZone = venueTimeZoneFromLocation(data as VenueTimeZoneFields | null) ?? undefined;
  } catch {
    /* fall back to UTC below */
  }
  try {
    return at.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZoneName: 'short', timeZone: timeZone ?? 'UTC',
    });
  } catch {
    return at.toISOString();
  }
}

/** One row of the new-lead details table. Empty values are left out. */
export interface NewLeadDetail {
  label: string;
  value: string | number | null | undefined;
}

/** Where a lead came from, in words an owner reads at a glance. */
const SOURCE_LABELS: Record<string, string> = {
  directory:    'StoryVenue listing',
  embed:        'Website form',
  webform:      'Website form',
  web_form:     'Website form',
  lead_link:    'Lead Link',
  form:         'Web form',
  leadfinder:   'LeadFinder™',
  manual:       'Added manually',
  test_inquiry: 'Test inquiry',
};

interface LeadRowForAlert {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  wedding_date?: string | null;
  guest_count?: number | null;
  booking_timeline?: string | null;
  venue_matters?: string | null;
  message?: string | null;
  source?: string | null;
  referral_source?: string | null;
  first_touch_utm?: Record<string, unknown> | null;
  created_at?: string | null;
}

/** "2027-06-12" → "Jun 12, 2027" (a date column has no time zone to shift). */
function displayDate(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return v;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The source line: the caller's label when it wrote one ("The Knot (via
 * LeadFinder™)", "Web form: Spring Open House"), else the lead's own `source`
 * in words — plus "via Meta" / "via Google" when the first-touch data shows the
 * click came from there.
 */
function describeLeadSource(callerSource: string | null | undefined, lead: LeadRowForAlert | null): string {
  const given = (callerSource ?? '').trim();
  const raw = (lead?.source ?? '').trim().toLowerCase();
  let label = given && !/^[a-z0-9_]+$/.test(given)
    ? given
    : SOURCE_LABELS[given || raw] ?? leadSourceLabel(given || raw || null);
  if (lead) {
    const bucket = bucketLeadSource({
      source: lead.source,
      referral_source: lead.referral_source,
      first_touch_utm: lead.first_touch_utm,
    });
    const via = bucket === 'meta' ? 'Meta' : bucket === 'google' ? 'Google' : null;
    if (via && !label.toLowerCase().includes(via.toLowerCase())) label += ` (via ${via})`;
  }
  return label;
}

/** The details table under the new-lead email's intro. Values are escaped here. */
function buildLeadDetailsHtml(rows: Array<{ label: string; value: string }>, message: string | null, note: string | null, original: OriginalEmail | null): string {
  const esc = escapeHtmlBasic;
  const tr = rows.map(r =>
    `<tr><td style="padding:6px 14px 6px 0;color:#6b7280;font-size:14px;white-space:nowrap;vertical-align:top;">${esc(r.label)}</td>` +
    `<td style="padding:6px 0;color:#111827;font-size:14px;word-break:break-word;">${esc(r.value)}</td></tr>`).join('');
  const box = (text: string) =>
    `<div style="padding:12px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;font-size:14px;line-height:1.6;color:#374151;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;">${esc(text)}</div>`;
  const caption = (text: string) =>
    `<p style="margin:18px 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">${esc(text)}</p>`;
  return [
    note ? `<p style="margin:8px 0 0;font-size:14px;font-weight:600;color:#b45309;">${esc(note)}</p>` : '',
    `<table role="presentation" style="width:100%;border-collapse:collapse;margin:12px 0 0;border-top:1px solid #f3f4f6;">${tr}</table>`,
    message ? caption('Their message') + box(message) : '',
    original
      ? caption('The original email') +
        `<p style="margin:0 0 6px;font-size:12px;color:#6b7280;">${esc([original.from && `From: ${original.from}`, original.subject && `Subject: ${original.subject}`].filter(Boolean).join(' · '))}</p>` +
        box(original.text)
      : '',
  ].join('');
}

interface OriginalEmail {
  from: string | null;
  subject: string | null;
  text: string;
}

/**
 * THE owner email for a new lead — one per lead, whatever the source (StoryVenue
 * listing, Lead Link, website embed, builder forms incl. Meta campaign forms,
 * LeadFinder™, manual add, API). It lists where the lead came from and
 * everything they submitted: the lead row's own fields (read here, so every
 * caller gets them) plus any extra answers the caller passes. Push and SMS go
 * out with it per each person's toggles.
 */
export function notifyOwnerNewLead(input: {
  venueId: string;
  /** Null only when a form submission had no email to make a lead from. */
  leadId: string | null;
  fullName: string;
  email: string;
  phone?: string | null;
  /** A raw ingest token ("directory", "form") or a label already written for people. */
  source?: string | null;
  createdAt?: string | null;
  /** Extra answers (form fields, directory Q&A) — shown after the standard rows. */
  details?: NewLeadDetail[];
  /** Their message, when it isn't on the lead row. */
  message?: string | null;
  /** A line above the table, e.g. that LeadFinder is holding the lead for a check. */
  note?: string | null;
  /** LeadFinder: the email the lead was read from, so the owner still has it. */
  originalEmail?: OriginalEmail | null;
  /** See NotifyArgs.extraEmailRecipients. */
  extraEmailRecipients?: string[];
}): void {
  void (async () => {
    let lead: LeadRowForAlert | null = null;
    if (input.leadId) {
      const { data } = await supabaseAdmin.from('leads').select('*').eq('id', input.leadId).maybeSingle();
      lead = (data as LeadRowForAlert | null) ?? null;
    }
    const name = (input.fullName || '').trim()
      || [lead?.first_name, lead?.last_name].filter(Boolean).join(' ').trim()
      || (lead?.name ?? '').trim()
      || input.email
      || 'New lead';
    const email = (input.email || lead?.email || '').trim();
    const phone = displayPhone(input.phone || lead?.phone) || 'Not provided';
    const source = describeLeadSource(input.source, lead);
    const createdAt = await formatInVenueTime(input.venueId, input.createdAt || lead?.created_at);
    const campaign = typeof lead?.first_touch_utm?.utm_campaign === 'string' ? lead.first_touch_utm.utm_campaign : null;

    const rows: Array<{ label: string; value: string }> = [];
    const taken = new Set<string>();
    const add = (label: string, value: string | number | null | undefined) => {
      const v = value == null ? '' : String(value).trim();
      const key = label.trim().toLowerCase();
      if (!v || taken.has(key)) return;
      taken.add(key);
      rows.push({ label, value: v });
    };
    add('Source', source);
    add('Campaign', campaign);
    add('Name', name);
    add('Email', email || 'Not provided');
    add('Phone', phone);
    add('Wedding date', displayDate(lead?.wedding_date));
    add('Guests', lead?.guest_count);
    add('Touring timeline', lead?.booking_timeline);
    add('What matters most', lead?.venue_matters);
    // Caller answers that repeat a standard row (a form's own "Email" field) are skipped.
    const standard = new Set(['name', 'first name', 'last name', 'full name', 'email', 'email address', 'phone', 'phone number', 'mobile', 'mobile phone', 'message']);
    for (const d of input.details ?? []) {
      if (!standard.has(d.label.trim().toLowerCase())) add(d.label, d.value);
    }
    add('Received', createdAt);
    const message = (input.message ?? lead?.message ?? '').trim() || null;

    await notifyOwner({
      venueId:   input.venueId,
      scenario:  'new_lead',
      vars: {
        customer_name: name,
        email,
        phone,
        source,
        created_at:    createdAt,
      },
      extraHtml: buildLeadDetailsHtml(rows, message, input.note?.trim() || null, input.originalEmail ?? null),
      // "Reply" in the owner's inbox writes straight to the couple.
      replyTo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
      // A lead id → the resolver route (the contact page is keyed by contact id).
      actionUrl: input.leadId ? `/dashboard/contacts/lead/${input.leadId}` : '/dashboard/leads',
      extraEmailRecipients: input.extraEmailRecipients,
    });
  })().catch((err) => console.error('[notifyOwnerNewLead]', err instanceof Error ? err.message : err));
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

    // Capitalize the first letter of each word in the name so it always
    // reads "Jason Westbrook" instead of "jason westbrook".
    display = display.replace(/\b\w/g, (c) => c.toUpperCase());

    await notifyOwner({
      venueId:   input.venueId,
      scenario:  'new_message',
      vars: {
        customer_name:   display,
        message_preview: preview,
      },
      actionUrl: `/dashboard/conversations?thread=${input.threadId}`,
      threadId:  input.threadId,
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
    // A lead id → the resolver route (the contact page is keyed by contact id).
    actionUrl: `/dashboard/contacts/lead/${input.leadId}`,
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
