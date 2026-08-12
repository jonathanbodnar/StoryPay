/**
 * Per-person notification preferences — email + SMS only (push is handled
 * separately by the native app / venue_notifications.settings and is
 * intentionally untouched here — see PushNotificationsClientPage.tsx).
 *
 * Every owner/team alert scenario gets its own `email_<scenario>` /
 * `sms_<scenario>` boolean, stored per PERSON (not per venue):
 *   - the account owner's live on `venues.notification_settings`
 *   - each team member's live on their own `venue_team_members.notification_settings` row
 *
 * This means five teammates can each decide independently whether they want
 * a text when a payment fails, without touching anyone else's preferences —
 * unlike the old venue-wide `venue_notifications.settings` bag (still used
 * for push toggles only).
 *
 * `ai_handoff` and `venue_direct` are two separate scenarios even though
 * both are "a bride needs your attention right now" from the owner's point
 * of view — the AI Concierge auto-escalating (owner-notifications.ts's
 * `ai_handoff` scenario) and the concierge support team manually sending a
 * "Venue Direct" message (/api/admin/support/venue-direct/route.ts) are
 * different triggers with different content, so each gets its own toggle.
 */

import { supabaseAdmin } from '@/lib/supabase';

export const NOTIFICATION_SCENARIOS = [
  {
    key: 'new_lead',
    label: 'New lead',
    description: 'Someone enquires about your venue.',
    icon: 'UserPlus',
    emailDefault: true,
    smsDefault: false,
  },
  {
    key: 'new_message',
    label: 'Contact replied',
    description: 'A contact sends a reply to an ongoing conversation.',
    icon: 'MessageSquare',
    emailDefault: true,
    smsDefault: false,
  },
  {
    key: 'ai_handoff',
    label: 'AI Concierge handoff',
    description: 'The AI Concierge escalates a conversation and needs you to take over.',
    icon: 'Bot',
    emailDefault: true,
    smsDefault: true,
  },
  {
    key: 'venue_direct',
    label: 'Venue Direct message',
    description: 'Our concierge team sends you a direct message about a specific bride.',
    icon: 'Building2',
    emailDefault: true,
    smsDefault: true,
  },
  {
    key: 'payment_received',
    label: 'Payment received',
    description: 'Any successful payment comes in.',
    icon: 'CreditCard',
    emailDefault: true,
    smsDefault: false,
  },
  {
    key: 'payment_failed',
    label: 'Payment failed',
    description: 'A charge attempt fails.',
    icon: 'AlertTriangle',
    emailDefault: true,
    smsDefault: true,
  },
  {
    key: 'proposal_signed',
    label: 'Proposal signed',
    description: 'A customer signs a proposal.',
    icon: 'FileSignature',
    emailDefault: true,
    smsDefault: false,
  },
  {
    key: 'document_viewed',
    label: 'Document opened',
    description: 'A customer opens a proposal or invoice you sent.',
    icon: 'Eye',
    emailDefault: false,
    smsDefault: false,
  },
  {
    key: 'refund_issued',
    label: 'Refund issued',
    description: 'A refund is processed.',
    icon: 'RefreshCw',
    emailDefault: true,
    smsDefault: false,
  },
  {
    key: 'subscription_created',
    label: 'New subscription',
    description: 'A recurring payment plan starts.',
    icon: 'RefreshCw',
    emailDefault: true,
    smsDefault: false,
  },
] as const;
// Removed as of 2026-08-11: `invoice_paid`, `subscription_cancelled`, and
// `new_customer` were defined here (and had matching toggles + push keys)
// but nothing anywhere in the app ever called notifyOwner() with those
// scenarios — invoice payments already fire `payment_received`, there is no
// code path that cancels a customer's proposal subscription, and there is
// no distinct "new customer" event separate from `new_lead`. Rather than
// ship toggles that silently do nothing, they were removed. Re-add here
// (plus SCENARIO_META in owner-notifications.ts) if/when those flows exist.

export type NotificationScenarioKey = typeof NOTIFICATION_SCENARIOS[number]['key'];

/** Flat `{ email_x: bool, sms_x: bool, ... }` defaults, built from the table above. */
export const DEFAULT_PERSON_NOTIFICATIONS: Record<string, boolean> = NOTIFICATION_SCENARIOS.reduce(
  (acc, s) => {
    acc[`email_${s.key}`] = s.emailDefault;
    acc[`sms_${s.key}`] = s.smsDefault;
    return acc;
  },
  {} as Record<string, boolean>,
);

/** Merge a saved (possibly partial / possibly null) settings blob over the defaults. */
export function mergePersonNotificationSettings(saved: unknown): Record<string, boolean> {
  const obj = saved && typeof saved === 'object' && !Array.isArray(saved)
    ? (saved as Record<string, unknown>)
    : {};
  const merged: Record<string, boolean> = { ...DEFAULT_PERSON_NOTIFICATIONS };
  for (const key of Object.keys(DEFAULT_PERSON_NOTIFICATIONS)) {
    if (typeof obj[key] === 'boolean') merged[key] = obj[key] as boolean;
  }
  return merged;
}

export function emailKeyFor(scenario: string): string { return `email_${scenario}`; }
export function smsKeyFor(scenario: string): string { return `sms_${scenario}`; }

export interface NotificationRecipient {
  kind: 'owner' | 'member';
  /** venue id for the owner, venue_team_members.id for a teammate. */
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  settings: Record<string, boolean>;
}

interface VenueNotifRow {
  id: string;
  name: string | null;
  email: string | null;
  notification_email: string | null;
  notification_phone: string | null;
  phone: string | null;
  notification_settings: unknown;
}

interface MemberNotifRow {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  notification_settings: unknown;
}

/**
 * Every person who should be considered for owner/team alerts on a venue —
 * the account owner plus every active team member. Best-effort: returns an
 * empty array (never throws) if the venue can't be loaded, so a notify call
 * degrades to "send nothing" instead of crashing the caller's main flow.
 */
export async function loadNotificationRecipients(venueId: string): Promise<NotificationRecipient[]> {
  const [{ data: venue, error: venueErr }, { data: members, error: memberErr }] = await Promise.all([
    supabaseAdmin
      .from('venues')
      .select('id, name, email, notification_email, notification_phone, phone, notification_settings')
      .eq('id', venueId)
      .maybeSingle(),
    supabaseAdmin
      .from('venue_team_members')
      .select('id, name, first_name, last_name, email, phone, notification_settings')
      .eq('venue_id', venueId)
      .neq('status', 'inactive'),
  ]);

  if (venueErr) console.warn('[notification-settings] venue load failed:', venueErr.message);
  if (memberErr) console.warn('[notification-settings] team member load failed:', memberErr.message);

  const recipients: NotificationRecipient[] = [];

  const v = venue as VenueNotifRow | null;
  if (v) {
    recipients.push({
      kind: 'owner',
      id: v.id,
      name: v.name,
      email: v.notification_email || v.email || null,
      phone: v.notification_phone || v.phone || null,
      settings: mergePersonNotificationSettings(v.notification_settings),
    });
  }

  for (const m of ((members ?? []) as MemberNotifRow[])) {
    if (!m.email) continue; // no way to notify — skip rather than crash on a blank recipient
    recipients.push({
      kind: 'member',
      id: m.id,
      name: m.name || [m.first_name, m.last_name].filter(Boolean).join(' ') || null,
      email: m.email,
      phone: m.phone || null,
      settings: mergePersonNotificationSettings(m.notification_settings),
    });
  }

  return recipients;
}
