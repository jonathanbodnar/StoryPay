/**
 * Smart Trigger Catalog
 * ─────────────────────
 * User-friendly, categorised triggers that map to the existing automation
 * trigger machinery. Most resolve to a `tag_added` trigger pre-configured
 * with one of the 65 system tags — when that tag is auto-applied (e.g.
 * `appointment_booked` after a booking), the workflow fires.
 *
 * Native triggers (form_submitted, stage_changed, etc.) are also included
 * so power users can pick the underlying primitives.
 */

import type { AutomationTriggerType } from '@/lib/marketing-email-schema';

export type SmartTriggerCategory =
  | 'lead'
  | 'booking'
  | 'proposal'
  | 'payments'
  | 'marketing'
  | 'communication'
  | 'forms'
  | 'event'
  | 'integration'
  | 'native';

export const SMART_TRIGGER_CATEGORIES: { id: SmartTriggerCategory; label: string; color: string }[] = [
  { id: 'lead',          label: 'Lead Lifecycle',  color: 'text-blue-700 bg-blue-50 border-blue-100' },
  { id: 'booking',       label: 'Booking',         color: 'text-cyan-700 bg-cyan-50 border-cyan-100' },
  { id: 'proposal',      label: 'Proposal',        color: 'text-violet-700 bg-violet-50 border-violet-100' },
  { id: 'payments',      label: 'Payments',        color: 'text-amber-700 bg-amber-50 border-amber-100' },
  { id: 'marketing',     label: 'Marketing',       color: 'text-indigo-700 bg-indigo-50 border-indigo-100' },
  { id: 'communication', label: 'Communication',   color: 'text-rose-700 bg-rose-50 border-rose-100' },
  { id: 'forms',         label: 'Forms',           color: 'text-purple-700 bg-purple-50 border-purple-100' },
  { id: 'event',         label: 'Event / Wedding', color: 'text-pink-700 bg-pink-50 border-pink-100' },
  { id: 'integration',   label: 'Integration',     color: 'text-sky-700 bg-sky-50 border-sky-100' },
  { id: 'native',        label: 'Other Triggers',  color: 'text-gray-700 bg-gray-50 border-gray-200' },
];

export interface SmartTrigger {
  id: string;                                // unique key for this option
  category: SmartTriggerCategory;
  label: string;                             // "When appointment is booked"
  description: string;                       // longer description
  type: AutomationTriggerType;               // resolves to this trigger type
  system_key?: string;                       // for tag_added: preselects this system tag
  iconName: 'tag' | 'calendar' | 'mail' | 'sms' | 'dollar' | 'file-signature' | 'clipboard'
          | 'link' | 'user-plus' | 'gift' | 'heart' | 'phone' | 'sparkles' | 'send'
          | 'check' | 'x' | 'eye' | 'plug' | 'shield' | 'zap';
}

export const SMART_TRIGGERS: SmartTrigger[] = [
  // ── Lead Lifecycle ──────────────────────────────────────────────────────────
  { id: 'new_lead',          category: 'lead', label: 'New lead created',         description: 'Fires the moment a lead first enters the system.', type: 'tag_added', system_key: 'new_lead',          iconName: 'user-plus' },
  { id: 'inquiry_received',  category: 'lead', label: 'Inquiry received',         description: 'A lead submitted any inquiry form.',               type: 'tag_added', system_key: 'inquiry_received',  iconName: 'clipboard' },
  { id: 'qualified',         category: 'lead', label: 'Lead qualified',           description: 'Lead matches your booking criteria.',              type: 'tag_added', system_key: 'qualified',         iconName: 'check' },
  { id: 'unqualified',       category: 'lead', label: 'Lead unqualified',         description: 'Lead does not meet your criteria.',                type: 'tag_added', system_key: 'unqualified',       iconName: 'x' },
  { id: 'in_negotiation',    category: 'lead', label: 'In negotiation',           description: 'Proposal sent and actively discussing terms.',     type: 'tag_added', system_key: 'in_negotiation',    iconName: 'sparkles' },
  { id: 'closed_won',        category: 'lead', label: 'Lead closed (won)',        description: 'Booking confirmed — deal closed.',                 type: 'tag_added', system_key: 'closed_won',        iconName: 'check' },
  { id: 'closed_lost',       category: 'lead', label: 'Lead closed (lost)',       description: 'Lead booked elsewhere or went cold.',              type: 'tag_added', system_key: 'closed_lost',       iconName: 'x' },
  { id: 'follow_up_needed',  category: 'lead', label: 'Follow-up needed',         description: 'Manually flagged or after extended inactivity.',   type: 'tag_added', system_key: 'follow_up_needed',  iconName: 'sparkles' },

  // ── Booking ─────────────────────────────────────────────────────────────────
  { id: 'appointment_booked',     category: 'booking', label: 'Appointment booked',       description: 'Any appointment was created for this contact.',  type: 'tag_added', system_key: 'appointment_booked',     iconName: 'calendar' },
  { id: 'tour_scheduled',         category: 'booking', label: 'Tour scheduled',           description: 'A tour appointment was booked.',                 type: 'tag_added', system_key: 'tour_scheduled',         iconName: 'calendar' },
  { id: 'tour_completed',         category: 'booking', label: 'Tour completed',           description: 'After-tour follow-up has fired.',                type: 'tag_added', system_key: 'tour_completed',         iconName: 'check' },
  { id: 'tour_no_show',           category: 'booking', label: 'Tour no-show',             description: 'Contact missed their scheduled tour.',           type: 'tag_added', system_key: 'tour_no_show',           iconName: 'x' },
  { id: 'tour_cancelled',         category: 'booking', label: 'Tour cancelled',           description: 'A tour was cancelled or deleted.',               type: 'tag_added', system_key: 'tour_cancelled',         iconName: 'x' },
  { id: 'call_scheduled',         category: 'booking', label: 'Phone call scheduled',     description: 'A phone call appointment was booked.',           type: 'tag_added', system_key: 'call_scheduled',         iconName: 'phone' },
  { id: 'call_completed',         category: 'booking', label: 'Phone call completed',     description: 'Phone call follow-up has fired.',                type: 'tag_added', system_key: 'call_completed',         iconName: 'check' },
  { id: 'appointment_confirmed',  category: 'booking', label: 'Appointment confirmed',    description: 'Appointment status changed to confirmed.',       type: 'tag_added', system_key: 'appointment_confirmed',  iconName: 'check' },
  { id: 'appointment_cancelled',  category: 'booking', label: 'Appointment cancelled',    description: 'Any appointment was cancelled or deleted.',      type: 'tag_added', system_key: 'appointment_cancelled',  iconName: 'x' },
  { id: 'appointment_rescheduled',category: 'booking', label: 'Appointment rescheduled',  description: 'Appointment was moved to a new time.',           type: 'tag_added', system_key: 'appointment_rescheduled',iconName: 'calendar' },

  // ── Proposal ────────────────────────────────────────────────────────────────
  { id: 'proposal_sent',     category: 'proposal', label: 'Proposal sent',         description: 'A proposal email was delivered.',                       type: 'tag_added', system_key: 'proposal_sent',     iconName: 'send' },
  { id: 'proposal_viewed',   category: 'proposal', label: 'Proposal viewed',       description: 'Contact opened the proposal link.',                     type: 'tag_added', system_key: 'proposal_viewed',   iconName: 'eye' },
  { id: 'proposal_signed',   category: 'proposal', label: 'Proposal signed',       description: 'Contact e-signed the proposal.',                        type: 'tag_added', system_key: 'proposal_signed',   iconName: 'file-signature' },
  { id: 'proposal_expired',  category: 'proposal', label: 'Proposal expired',      description: 'Proposal passed its due date with no signature.',       type: 'tag_added', system_key: 'proposal_expired',  iconName: 'x' },
  { id: 'contract_signed',   category: 'proposal', label: 'Contract signed',       description: 'Contract fully executed by all parties.',               type: 'tag_added', system_key: 'contract_signed',   iconName: 'file-signature' },

  // ── Payments ────────────────────────────────────────────────────────────────
  { id: 'invoice_sent',         category: 'payments', label: 'Invoice sent',         description: 'An invoice email was delivered.',                       type: 'tag_added', system_key: 'invoice_sent',         iconName: 'send' },
  { id: 'invoice_viewed',       category: 'payments', label: 'Invoice viewed',       description: 'Contact opened the invoice link.',                      type: 'tag_added', system_key: 'invoice_viewed',       iconName: 'eye' },
  { id: 'deposit_paid',         category: 'payments', label: 'Deposit paid',         description: 'First or retainer payment received.',                   type: 'tag_added', system_key: 'deposit_paid',         iconName: 'dollar' },
  { id: 'paid_in_full',         category: 'payments', label: 'Paid in full',         description: 'All payments received \u2014 zero balance.',            type: 'tag_added', system_key: 'paid_in_full',         iconName: 'check' },
  { id: 'payment_plan_active',  category: 'payments', label: 'Payment plan active',  description: 'Subscription or installment plan started.',             type: 'tag_added', system_key: 'payment_plan_active',  iconName: 'dollar' },
  { id: 'payment_failed',       category: 'payments', label: 'Payment failed',       description: 'A card or ACH payment was declined.',                   type: 'tag_added', system_key: 'payment_failed',       iconName: 'x' },
  { id: 'refunded',             category: 'payments', label: 'Refunded',             description: 'Payment was returned to the contact.',                  type: 'tag_added', system_key: 'refunded',             iconName: 'dollar' },
  { id: 'past_due',             category: 'payments', label: 'Past due',             description: 'Payment is overdue.',                                   type: 'tag_added', system_key: 'past_due',             iconName: 'x' },

  // ── Marketing Engagement ────────────────────────────────────────────────────
  { id: 'email_opened',          category: 'marketing', label: 'Email opened',          description: 'Contact opened a marketing email.',                  type: 'tag_added', system_key: 'email_opened',          iconName: 'mail' },
  { id: 'email_clicked',         category: 'marketing', label: 'Email link clicked',    description: 'Contact clicked a link in a marketing email.',       type: 'tag_added', system_key: 'email_clicked',         iconName: 'link' },
  { id: 'campaign_enrolled',     category: 'marketing', label: 'Campaign enrolled',     description: 'Contact was added to an email automation.',          type: 'tag_added', system_key: 'campaign_enrolled',     iconName: 'sparkles' },
  { id: 'campaign_completed',    category: 'marketing', label: 'Campaign completed',    description: 'Contact finished all steps of an automation.',       type: 'tag_added', system_key: 'campaign_completed',    iconName: 'check' },
  { id: 'campaign_unsubscribed', category: 'marketing', label: 'Unsubscribed',          description: 'Contact opted out of marketing emails.',             type: 'tag_added', system_key: 'campaign_unsubscribed', iconName: 'x' },
  { id: 'sms_opted_in',          category: 'marketing', label: 'SMS opted in',          description: 'Contact consented to receive SMS.',                  type: 'tag_added', system_key: 'sms_opted_in',          iconName: 'sms' },
  { id: 'sms_opted_out',         category: 'marketing', label: 'SMS opted out',         description: 'Contact replied STOP or DND was set for SMS.',       type: 'tag_added', system_key: 'sms_opted_out',         iconName: 'x' },
  { id: 're_engaged',            category: 'marketing', label: 'Re-engaged',            description: 'Cold lead opened a message or replied.',             type: 'tag_added', system_key: 're_engaged',            iconName: 'sparkles' },

  // ── Communication ───────────────────────────────────────────────────────────
  { id: 'replied',         category: 'communication', label: 'Contact replied',      description: 'Contact sent a message on any channel.',            type: 'tag_added', system_key: 'replied',         iconName: 'sms' },
  { id: 'hot_lead',        category: 'communication', label: 'Hot lead detected',    description: 'High engagement or strong interest signal.',        type: 'tag_added', system_key: 'hot_lead',        iconName: 'zap' },
  { id: 'cold_lead',       category: 'communication', label: 'Cold lead detected',   description: 'No activity for 30+ days.',                         type: 'tag_added', system_key: 'cold_lead',       iconName: 'x' },
  { id: 'do_not_contact',  category: 'communication', label: 'Do not contact set',   description: 'Global block was applied \u2014 stop all outbound.',type: 'tag_added', system_key: 'do_not_contact',  iconName: 'shield' },
  { id: 'vip',             category: 'communication', label: 'VIP flagged',          description: 'Contact was marked as VIP.',                        type: 'tag_added', system_key: 'vip',             iconName: 'sparkles' },

  // ── Forms ───────────────────────────────────────────────────────────────────
  { id: 'form_any',                category: 'forms', label: 'Any form submitted',          description: 'Any marketing form submission \u2014 you can pick specific forms in the trigger config.', type: 'form_submitted', iconName: 'clipboard' },
  { id: 'form_submitted_tag',      category: 'forms', label: 'Form submission tagged',      description: 'Auto-applied form_submitted tag fires.',  type: 'tag_added', system_key: 'form_submitted',      iconName: 'clipboard' },
  { id: 'intake_completed',        category: 'forms', label: 'Intake form completed',       description: 'Pre-booking intake questionnaire completed.',  type: 'tag_added', system_key: 'intake_completed',        iconName: 'check' },
  { id: 'questionnaire_completed', category: 'forms', label: 'Questionnaire completed',     description: 'A returned questionnaire response.',  type: 'tag_added', system_key: 'questionnaire_completed', iconName: 'check' },

  // ── Event / Wedding ─────────────────────────────────────────────────────────
  { id: 'wedding_followup',  category: 'event', label: 'After wedding date',     description: 'Fire N days before/after the wedding date.',           type: 'wedding_date_followup', iconName: 'heart' },
  { id: 'date_confirmed',    category: 'event', label: 'Date confirmed',         description: 'Deposit paid and date officially booked.',             type: 'tag_added', system_key: 'date_confirmed',    iconName: 'calendar' },
  { id: 'date_held',         category: 'event', label: 'Date held',              description: 'Soft-hold placed pending deposit.',                    type: 'tag_added', system_key: 'date_held',         iconName: 'calendar' },
  { id: 'within_30_days',    category: 'event', label: 'Within 30 days of event',description: 'Auto-fires when event is < 30 days away.',             type: 'tag_added', system_key: 'within_30_days',    iconName: 'calendar' },
  { id: 'within_7_days',     category: 'event', label: 'Within 7 days of event', description: 'Auto-fires when event is < 7 days away.',              type: 'tag_added', system_key: 'within_7_days',     iconName: 'calendar' },
  { id: 'event_passed',      category: 'event', label: 'Event date passed',      description: 'The wedding/event date has passed.',                   type: 'tag_added', system_key: 'event_passed',      iconName: 'calendar' },
  { id: 'anniversary_year_1',category: 'event', label: 'Year-1 anniversary',     description: 'One year after the event \u2014 great for referral asks.',type: 'tag_added', system_key: 'anniversary_year_1',iconName: 'gift' },

  // ── Integration ─────────────────────────────────────────────────────────────
  { id: 'ghl_synced',     category: 'integration', label: 'Legacy contact synced',  description: 'Contact synced from StoryVenue Legacy messaging.',  type: 'tag_added', system_key: 'ghl_synced',     iconName: 'plug' },
  { id: 'ghl_dnd_active', category: 'integration', label: 'Legacy DND active',      description: 'Legacy messaging Do-Not-Disturb is enabled.',       type: 'tag_added', system_key: 'ghl_dnd_active', iconName: 'shield' },

  // ── Native (raw triggers) ───────────────────────────────────────────────────
  { id: 'native_tag_added',      category: 'native', label: 'Custom tag added',         description: 'Fire when any tag (including your own custom tags) is added.', type: 'tag_added',          iconName: 'tag' },
  { id: 'native_stage_changed',  category: 'native', label: 'Pipeline stage changed',   description: 'Fire when a lead moves into a specific stage.',  type: 'stage_changed',         iconName: 'sparkles' },
  { id: 'native_link_click',     category: 'native', label: 'Trigger link clicked',     description: 'Fire when a contact clicks a tracked trigger link.',type: 'trigger_link_click',  iconName: 'link' },
  { id: 'native_proposal_paid',  category: 'native', label: 'Proposal paid',            description: 'Fire when a proposal payment succeeds.',          type: 'proposal_paid',         iconName: 'dollar' },
];

/** Find a smart-trigger by id. */
export function findSmartTrigger(id: string): SmartTrigger | undefined {
  return SMART_TRIGGERS.find((t) => t.id === id);
}

/** Group smart triggers by category and apply an optional search query. */
export function groupSmartTriggers(query: string): Record<SmartTriggerCategory, SmartTrigger[]> {
  const q = query.trim().toLowerCase();
  const out = {} as Record<SmartTriggerCategory, SmartTrigger[]>;
  for (const cat of SMART_TRIGGER_CATEGORIES) out[cat.id] = [];
  for (const t of SMART_TRIGGERS) {
    if (q && !t.label.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) continue;
    out[t.category].push(t);
  }
  return out;
}
