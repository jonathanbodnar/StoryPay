/**
 * System-default tags — seeded per venue, non-deletable.
 *
 * Each tag has a stable system_key so every auto-apply hook can find it
 * without knowing the venue-specific UUID.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { onMarketingTagAdded } from '@/lib/marketing-email-worker';
import { dispatchIntegrationEvent } from '@/lib/integration-events';

// ── Canonical tag definitions ─────────────────────────────────────────────────

export interface SystemTagDef {
  system_key: string;
  name: string;
  category: string;
  description: string;
  /** Which system events auto-apply this tag */
  auto_apply_events: string[];
  color: string;
}

export const SYSTEM_TAG_DEFS: SystemTagDef[] = [
  // ── Lead Lifecycle ──────────────────────────────────────────────────────────
  { system_key: 'new_lead',           name: 'New Lead',            category: 'Lead Lifecycle',  description: 'Applied when a lead first enters the system',                      auto_apply_events: ['lead.created'],                color: '#3b82f6' },
  { system_key: 'inquiry_received',   name: 'Inquiry Received',    category: 'Lead Lifecycle',  description: 'Lead submitted an inquiry form',                                   auto_apply_events: ['lead.created'],                color: '#6366f1' },
  { system_key: 'contacted',          name: 'Contacted',           category: 'Lead Lifecycle',  description: 'First outbound message sent to this lead',                         auto_apply_events: [],                              color: '#8b5cf6' },
  { system_key: 'awaiting_response',  name: 'Awaiting Response',   category: 'Lead Lifecycle',  description: 'Message sent, waiting for reply',                                  auto_apply_events: [],                              color: '#a78bfa' },
  { system_key: 'follow_up_needed',   name: 'Follow-Up Needed',    category: 'Lead Lifecycle',  description: 'Manually flagged or auto-applied after inactivity',                auto_apply_events: [],                              color: '#f59e0b' },
  { system_key: 'qualified',          name: 'Qualified',           category: 'Lead Lifecycle',  description: 'Lead meets your booking criteria',                                 auto_apply_events: [],                              color: '#10b981' },
  { system_key: 'unqualified',        name: 'Unqualified',         category: 'Lead Lifecycle',  description: 'Lead does not meet your criteria',                                 auto_apply_events: [],                              color: '#ef4444' },
  { system_key: 'in_negotiation',     name: 'In Negotiation',      category: 'Lead Lifecycle',  description: 'Proposal sent, actively discussing terms',                         auto_apply_events: [],                              color: '#f97316' },
  { system_key: 'closed_won',         name: 'Closed Won',          category: 'Lead Lifecycle',  description: 'Booking confirmed, deal closed',                                   auto_apply_events: ['payment.received'],            color: '#22c55e' },
  { system_key: 'closed_lost',        name: 'Closed Lost',         category: 'Lead Lifecycle',  description: 'Lead went with another venue',                                     auto_apply_events: [],                              color: '#6b7280' },
  { system_key: 'inactive',           name: 'Inactive',            category: 'Lead Lifecycle',  description: 'No activity for an extended period',                               auto_apply_events: [],                              color: '#9ca3af' },
  { system_key: 'archived',           name: 'Archived',            category: 'Lead Lifecycle',  description: 'Removed from active pipeline',                                     auto_apply_events: [],                              color: '#d1d5db' },
  // ── Booking / Appointment ───────────────────────────────────────────────────
  { system_key: 'appointment_booked', name: 'Appointment Booked',  category: 'Booking',         description: 'Any appointment was created for this contact',                     auto_apply_events: ['appointment.booked'],          color: '#0ea5e9' },
  { system_key: 'tour_scheduled',     name: 'Tour Scheduled',      category: 'Booking',         description: 'A tour appointment was booked',                                    auto_apply_events: ['appointment.tour_booked'],     color: '#0284c7' },
  { system_key: 'tour_completed',     name: 'Tour Completed',      category: 'Booking',         description: 'Applied after a tour follow-up fires',                             auto_apply_events: ['appointment.tour_followup'],   color: '#0369a1' },
  { system_key: 'tour_no_show',       name: 'Tour No-Show',        category: 'Booking',         description: 'Contact missed their scheduled tour',                              auto_apply_events: [],                              color: '#dc2626' },
  { system_key: 'tour_cancelled',     name: 'Tour Cancelled',      category: 'Booking',         description: 'Tour appointment was cancelled',                                   auto_apply_events: ['appointment.tour_cancelled'],  color: '#b91c1c' },
  { system_key: 'call_scheduled',     name: 'Call Scheduled',      category: 'Booking',         description: 'A phone call appointment was booked',                              auto_apply_events: ['appointment.call_booked'],     color: '#7c3aed' },
  { system_key: 'call_completed',     name: 'Call Completed',      category: 'Booking',         description: 'Phone call follow-up fired',                                       auto_apply_events: ['appointment.call_followup'],   color: '#6d28d9' },
  { system_key: 'appointment_confirmed', name: 'Appointment Confirmed', category: 'Booking',    description: 'Appointment status changed to confirmed',                          auto_apply_events: ['appointment.confirmed'],       color: '#16a34a' },
  { system_key: 'appointment_cancelled', name: 'Appointment Cancelled', category: 'Booking',    description: 'Any appointment was cancelled or deleted',                         auto_apply_events: ['appointment.cancelled'],       color: '#dc2626' },
  { system_key: 'appointment_rescheduled', name: 'Appointment Rescheduled', category: 'Booking', description: 'Appointment was moved to a new time',                            auto_apply_events: ['appointment.rescheduled'],     color: '#d97706' },
  // ── Proposal & Contract ─────────────────────────────────────────────────────
  { system_key: 'proposal_sent',      name: 'Proposal Sent',       category: 'Proposal',        description: 'Proposal email was delivered',                                     auto_apply_events: ['proposal.sent'],               color: '#8b5cf6' },
  { system_key: 'proposal_viewed',    name: 'Proposal Viewed',     category: 'Proposal',        description: 'Contact opened the proposal link',                                 auto_apply_events: ['proposal.viewed'],             color: '#7c3aed' },
  { system_key: 'proposal_signed',    name: 'Proposal Signed',     category: 'Proposal',        description: 'Contact e-signed the proposal',                                    auto_apply_events: ['proposal.signed'],             color: '#6d28d9' },
  { system_key: 'proposal_expired',   name: 'Proposal Expired',    category: 'Proposal',        description: 'Proposal past due date with no signature',                         auto_apply_events: [],                              color: '#9ca3af' },
  { system_key: 'contract_signed',    name: 'Contract Signed',     category: 'Proposal',        description: 'Contract fully executed by all parties',                           auto_apply_events: ['proposal.signed'],             color: '#059669' },
  // ── Payments & Invoicing ────────────────────────────────────────────────────
  { system_key: 'invoice_sent',       name: 'Invoice Sent',        category: 'Payments',        description: 'Invoice email was delivered to contact',                           auto_apply_events: ['invoice.sent'],                color: '#f59e0b' },
  { system_key: 'invoice_viewed',     name: 'Invoice Viewed',      category: 'Payments',        description: 'Contact opened the invoice link',                                  auto_apply_events: ['invoice.viewed'],              color: '#d97706' },
  { system_key: 'deposit_paid',       name: 'Deposit Paid',        category: 'Payments',        description: 'First or retainer payment was received',                           auto_apply_events: ['payment.received'],            color: '#10b981' },
  { system_key: 'payment_plan_active',name: 'Payment Plan Active', category: 'Payments',        description: 'Subscription or installment plan started',                         auto_apply_events: ['payment.subscription_started'],color: '#0d9488' },
  { system_key: 'balance_due',        name: 'Balance Due',         category: 'Payments',        description: 'Outstanding balance remains on this account',                      auto_apply_events: [],                              color: '#f97316' },
  { system_key: 'payment_failed',     name: 'Payment Failed',      category: 'Payments',        description: 'Card or ACH payment was declined',                                 auto_apply_events: ['payment.failed'],              color: '#ef4444' },
  { system_key: 'paid_in_full',       name: 'Paid in Full',        category: 'Payments',        description: 'All payments received — zero balance',                             auto_apply_events: ['payment.paid_in_full'],        color: '#22c55e' },
  { system_key: 'refunded',           name: 'Refunded',            category: 'Payments',        description: 'Payment was returned to the contact',                              auto_apply_events: ['payment.refunded'],            color: '#6b7280' },
  { system_key: 'past_due',           name: 'Past Due',            category: 'Payments',        description: 'Payment overdue',                                                  auto_apply_events: [],                              color: '#dc2626' },
  // ── Marketing Engagement ────────────────────────────────────────────────────
  { system_key: 'email_opened',       name: 'Email Opened',        category: 'Marketing',       description: 'Contact opened a marketing email',                                 auto_apply_events: ['marketing.email_opened'],      color: '#0ea5e9' },
  { system_key: 'email_clicked',      name: 'Email Clicked',       category: 'Marketing',       description: 'Contact clicked a link in a marketing email',                      auto_apply_events: ['marketing.email_clicked'],     color: '#0284c7' },
  { system_key: 'link_clicked',       name: 'Link Clicked',        category: 'Marketing',       description: 'A trigger link was clicked',                                       auto_apply_events: ['marketing.link_clicked'],      color: '#0369a1' },
  { system_key: 'campaign_enrolled',  name: 'Campaign Enrolled',   category: 'Marketing',       description: 'Contact was added to an email automation',                         auto_apply_events: ['marketing.campaign_enrolled'], color: '#4f46e5' },
  { system_key: 'campaign_completed', name: 'Campaign Completed',  category: 'Marketing',       description: 'Contact finished all steps of an automation',                      auto_apply_events: ['marketing.campaign_completed'],color: '#4338ca' },
  { system_key: 'campaign_unsubscribed', name: 'Campaign Unsubscribed', category: 'Marketing',  description: 'Contact opted out of marketing emails',                            auto_apply_events: ['marketing.unsubscribed'],      color: '#ef4444' },
  { system_key: 'sms_opted_in',       name: 'SMS Opted In',        category: 'Marketing',       description: 'Contact explicitly consented to receive SMS',                      auto_apply_events: ['sms.opted_in'],                color: '#10b981' },
  { system_key: 'sms_opted_out',      name: 'SMS Opted Out',       category: 'Marketing',       description: 'Contact replied STOP or DND was set for SMS',                      auto_apply_events: ['sms.opted_out'],               color: '#ef4444' },
  { system_key: 're_engaged',         name: 'Re-Engaged',          category: 'Marketing',       description: 'Previously cold lead opened a message or replied',                 auto_apply_events: [],                              color: '#f59e0b' },
  // ── Communication ───────────────────────────────────────────────────────────
  { system_key: 'replied',            name: 'Replied',             category: 'Communication',   description: 'Contact sent a message on any channel',                            auto_apply_events: [],                              color: '#3b82f6' },
  { system_key: 'hot_lead',           name: 'Hot Lead',            category: 'Communication',   description: 'High engagement or strong interest detected',                      auto_apply_events: [],                              color: '#ef4444' },
  { system_key: 'cold_lead',          name: 'Cold Lead',           category: 'Communication',   description: 'No activity for 30+ days',                                         auto_apply_events: [],                              color: '#6b7280' },
  { system_key: 'vip',                name: 'VIP',                 category: 'Communication',   description: 'High-priority contact, manually flagged',                          auto_apply_events: [],                              color: '#f59e0b' },
  { system_key: 'do_not_contact',     name: 'Do Not Contact',      category: 'Communication',   description: 'Global block — no outbound messages of any kind',                  auto_apply_events: [],                              color: '#1f2937' },
  // ── Forms & Intake ──────────────────────────────────────────────────────────
  { system_key: 'form_submitted',     name: 'Form Submitted',      category: 'Forms',           description: 'Any form submission was received',                                 auto_apply_events: ['lead.created'],                color: '#8b5cf6' },
  { system_key: 'intake_completed',   name: 'Intake Form Completed',category: 'Forms',          description: 'Pre-booking intake questionnaire completed',                       auto_apply_events: [],                              color: '#7c3aed' },
  { system_key: 'questionnaire_sent', name: 'Questionnaire Sent',  category: 'Forms',           description: 'Post-booking questionnaire delivered',                             auto_apply_events: [],                              color: '#6d28d9' },
  { system_key: 'questionnaire_completed', name: 'Questionnaire Completed', category: 'Forms', description: 'Questionnaire was returned',                                       auto_apply_events: [],                              color: '#5b21b6' },
  // ── Event / Wedding ─────────────────────────────────────────────────────────
  { system_key: 'date_available',     name: 'Date Available',      category: 'Event',           description: "Lead's requested date is open on the calendar",                    auto_apply_events: [],                              color: '#10b981' },
  { system_key: 'date_unavailable',   name: 'Date Unavailable',    category: 'Event',           description: "Lead's requested date is already taken",                           auto_apply_events: [],                              color: '#ef4444' },
  { system_key: 'date_held',          name: 'Date Held',           category: 'Event',           description: 'Soft-hold placed pending deposit',                                 auto_apply_events: [],                              color: '#f59e0b' },
  { system_key: 'date_confirmed',     name: 'Date Confirmed',      category: 'Event',           description: 'Deposit paid and date officially booked',                          auto_apply_events: ['payment.received'],            color: '#22c55e' },
  { system_key: 'within_30_days',     name: '< 30 Days Out',       category: 'Event',           description: 'Event is within the next 30 days',                                 auto_apply_events: [],                              color: '#f97316' },
  { system_key: 'within_7_days',      name: '< 7 Days Out',        category: 'Event',           description: 'Event is within the next 7 days',                                  auto_apply_events: [],                              color: '#dc2626' },
  { system_key: 'event_passed',       name: 'Event Passed',        category: 'Event',           description: 'The event date has passed',                                        auto_apply_events: [],                              color: '#9ca3af' },
  { system_key: 'anniversary_year_1', name: 'Anniversary Year 1',  category: 'Event',           description: '1 year after the event — great for referral workflows',            auto_apply_events: [],                              color: '#ec4899' },
  // ── Referral & Source ───────────────────────────────────────────────────────
  { system_key: 'referral',           name: 'Referral',            category: 'Referral',        description: 'Lead came from a referral',                                        auto_apply_events: [],                              color: '#14b8a6' },
  { system_key: 'directory_lead',     name: 'Directory Lead',      category: 'Referral',        description: 'Lead came from the StoryVenue directory',                          auto_apply_events: ['lead.directory_created'],      color: '#0d9488' },
  { system_key: 'google_lead',        name: 'Google Lead',         category: 'Referral',        description: 'Lead came from Google or GMB',                                     auto_apply_events: [],                              color: '#0f766e' },
  { system_key: 'social_media_lead',  name: 'Social Media Lead',   category: 'Referral',        description: 'Lead came from Instagram, TikTok, or other social',               auto_apply_events: [],                              color: '#0e7490' },
  { system_key: 'website_lead',       name: 'Website Lead',        category: 'Referral',        description: "Lead came from the venue's own website form",                      auto_apply_events: [],                              color: '#1d4ed8' },
  // ── Legacy Integration ───────────────────────────────────────────────────────
  { system_key: 'ghl_synced',         name: 'Legacy Synced',       category: 'Integration',     description: 'Contact has been successfully synced to Legacy messaging',          auto_apply_events: ['ghl.contact_synced'],          color: '#0ea5e9' },
  { system_key: 'ghl_dnd_active',     name: 'Legacy DND Active',   category: 'Integration',     description: 'Legacy messaging Do Not Disturb flag is active on any channel',     auto_apply_events: ['ghl.dnd_active'],              color: '#dc2626' },
  // ── AI Concierge state tags ──────────────────────────────────────────────
  // These mirror migration 120 so venues created after that migration (or
  // venues whose migration did not run) still get these tags via ensureSystemTagsForVenue.
  // Applying "AI Active" from the support sidebar triggers setLeadAiState('ai_active');
  // removing it calls setLeadAiState('paused') — see support action route.
  { system_key: 'ai_active',          name: 'AI Active',           category: 'AI Concierge',    description: 'Lead is currently being followed up by the AI Concierge',          auto_apply_events: [],                              color: '#10b981' },
  { system_key: 'ai_paused',          name: 'AI Paused',           category: 'AI Concierge',    description: 'AI Concierge follow-ups are temporarily paused for this lead',      auto_apply_events: [],                              color: '#f59e0b' },
  { system_key: 'ai_handoff',         name: 'AI Handoff',          category: 'AI Concierge',    description: 'AI Concierge has handed this lead off to a human team member',      auto_apply_events: [],                              color: '#6366f1' },
  { system_key: 'ai_opted_out',       name: 'AI Opted Out',        category: 'AI Concierge',    description: 'Lead has opted out of AI follow-ups (STOP keyword or DND)',         auto_apply_events: [],                              color: '#ef4444' },
  { system_key: 'ai_exhausted',       name: 'AI Exhausted',        category: 'AI Concierge',    description: 'AI Concierge has reached the maximum follow-up attempts for this lead', auto_apply_events: [],                           color: '#6b7280' },
];

// ── Utility functions ─────────────────────────────────────────────────────────

const SEED_LOCK = new Set<string>();
// Venues already fully seeded in THIS process — lets us skip the heavy DDL +
// upsert on hot paths (e.g. every support-sidebar load). Cleared on process
// restart (deploys), which is exactly when new tag defs ship.
const SEEDED = new Set<string>();
// Version stamp: bump whenever SYSTEM_TAG_DEFS grows so a running process
// re-seeds venues that were cached before the new tags were added.
const SEED_VERSION = 2; // bumped: added AI Concierge state tags
const _ver = SEED_VERSION; void _ver; // suppress unused-var lint

/**
 * Idempotent: ensure all system tags exist for a venue.
 * Also runs migration-085 DDL if the columns haven't been added yet so the
 * function works even on a fresh database before the migration is applied manually.
 *
 * @param force  Re-run even if already seeded this process (default false).
 */
export async function ensureSystemTagsForVenue(venueId: string, force = false): Promise<void> {
  if (!force && SEEDED.has(venueId)) return;   // already done this process
  if (SEED_LOCK.has(venueId)) return;          // avoid duplicate concurrent seeds
  SEED_LOCK.add(venueId);
  try {
    // ── 1. Ensure migration-085 columns exist (self-healing) ─────────────────
    const { getDbAsync } = await import('@/lib/db');
    const db = await getDbAsync();
    await db.unsafe(`
      ALTER TABLE public.marketing_tags
        ADD COLUMN IF NOT EXISTS is_system         boolean  NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS system_key        text,
        ADD COLUMN IF NOT EXISTS category          text,
        ADD COLUMN IF NOT EXISTS description       text,
        ADD COLUMN IF NOT EXISTS auto_apply_events text[]   NOT NULL DEFAULT '{}';

      CREATE UNIQUE INDEX IF NOT EXISTS marketing_tags_venue_system_key_uidx
        ON public.marketing_tags (venue_id, system_key)
        WHERE system_key IS NOT NULL;
    `).catch(() => { /* columns may already exist — ignore */ });

    // ── 2. Upsert all system tag definitions ─────────────────────────────────
    const rows = SYSTEM_TAG_DEFS.map((def, i) => ({
      venue_id:           venueId,
      name:               def.name,
      icon:               '',
      color:              def.color,
      position:           1000 + i,
      is_system:          true,
      system_key:         def.system_key,
      category:           def.category,
      description:        def.description,
      auto_apply_events:  def.auto_apply_events,
    }));

    const { error: upsertErr } = await supabaseAdmin
      .from('marketing_tags')
      .upsert(rows, { onConflict: 'venue_id,system_key', ignoreDuplicates: false })
      .select('id');

    if (upsertErr) {
      // onConflict can fail if the unique index isn't there yet. Fall back to
      // inserting only the system_keys that don't already exist so we never
      // leave a venue with an empty tag library.
      console.error('[system-tags] upsert failed, falling back to insert-missing:', upsertErr.message);
      const { data: existing } = await supabaseAdmin
        .from('marketing_tags')
        .select('system_key')
        .eq('venue_id', venueId)
        .not('system_key', 'is', null);
      const have = new Set((existing ?? []).map(r => (r as { system_key: string }).system_key));
      const missing = rows.filter(r => !have.has(r.system_key));
      if (missing.length > 0) {
        const { error: insErr } = await supabaseAdmin.from('marketing_tags').insert(missing);
        if (insErr) {
          console.error('[system-tags] insert-missing failed:', insErr.message);
          return; // do NOT mark seeded — retry next call
        }
      }
    }

    SEEDED.add(venueId); // success — skip the heavy path next time this process
  } catch (e) {
    console.error('[system-tags] ensureSystemTagsForVenue error:', e);
  } finally {
    SEED_LOCK.delete(venueId);
  }
}

/**
 * Find the tag UUID for a system_key in a venue's marketing_tags.
 * Returns null if the tag doesn't exist yet (call ensureSystemTagsForVenue first).
 */
async function resolveSystemTagId(venueId: string, systemKey: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('marketing_tags')
    .select('id')
    .eq('venue_id', venueId)
    .eq('system_key', systemKey)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Find a lead by email for a venue.
 */
async function resolveLeadIdByEmail(venueId: string, email: string): Promise<string | null> {
  if (!email?.trim()) return null;
  const { data } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('venue_id', venueId)
    .ilike('email', email.trim())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Apply a system tag to a lead (by lead UUID).
 * Fires onMarketingTagAdded so any workflow triggers fire.
 * Safe to call fire-and-forget.
 */
export async function applySystemTag(
  venueId: string,
  leadId: string,
  systemKey: string,
): Promise<void> {
  try {
    const tagId = await resolveSystemTagId(venueId, systemKey);
    if (!tagId) return;

    const { error } = await supabaseAdmin
      .from('lead_tag_assignments')
      .insert({ lead_id: leadId, tag_id: tagId, venue_id: venueId })
      .select('lead_id')
      .maybeSingle();

    if (error && error.code !== '23505') { // 23505 = duplicate, already assigned
      console.error(`[system-tags] applySystemTag(${systemKey}) error:`, error);
      return;
    }

    if (!error) {
      // Tag was newly added — fire workflow trigger and external integration event
      await onMarketingTagAdded(venueId, leadId, [tagId]);
      void dispatchIntegrationEvent(venueId, 'tag.added', {
        lead_id: leadId,
        tag: { id: tagId, system_key: systemKey },
      });
    }
  } catch (e) {
    console.error(`[system-tags] applySystemTag(${systemKey}) exception:`, e);
  }
}

/**
 * Remove a system tag from a lead.
 */
export async function removeSystemTag(
  venueId: string,
  leadId: string,
  systemKey: string,
): Promise<void> {
  try {
    const tagId = await resolveSystemTagId(venueId, systemKey);
    if (!tagId) return;
    await supabaseAdmin
      .from('lead_tag_assignments')
      .delete()
      .eq('lead_id', leadId)
      .eq('tag_id', tagId)
      .eq('venue_id', venueId);
  } catch (e) {
    console.error(`[system-tags] removeSystemTag(${systemKey}) exception:`, e);
  }
}

/**
 * Apply a system tag by looking up the lead via customer email.
 * Useful for invoice/proposal/calendar hooks that only have the email.
 * Safe to call fire-and-forget.
 */
export async function applySystemTagByEmail(
  venueId: string,
  email: string,
  systemKey: string,
): Promise<void> {
  try {
    const leadId = await resolveLeadIdByEmail(venueId, email);
    if (!leadId) return;
    await applySystemTag(venueId, leadId, systemKey);
  } catch (e) {
    console.error(`[system-tags] applySystemTagByEmail(${systemKey}) exception:`, e);
  }
}

/**
 * Apply multiple system tags at once (e.g. on lead creation).
 */
export async function applySystemTags(
  venueId: string,
  leadId: string,
  systemKeys: string[],
): Promise<void> {
  await Promise.all(systemKeys.map((k) => applySystemTag(venueId, leadId, k)));
}
