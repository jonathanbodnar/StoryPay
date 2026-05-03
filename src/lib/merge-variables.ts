/**
 * Canonical system merge variables — single source of truth for the entire platform.
 *
 * All three rendering systems (calendar notifications, marketing emails, transactional
 * emails) use renderMergeVars() which bridges across dot-notation and legacy flat aliases
 * so old templates keep working while new templates can use the unified syntax.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type MergeVarCategory =
  | 'contact'
  | 'appointment'
  | 'venue'
  | 'lead'
  | 'invoice'
  | 'proposal'
  | 'payment'
  | 'subscription'
  | 'marketing'
  | 'system';

export interface SystemMergeVar {
  /** Canonical dot-notation key, e.g. "contact.first_name" */
  key: string;
  /** Full tag syntax, e.g. "{{contact.first_name}}" */
  tag: string;
  /** Human-readable description */
  description: string;
  /** Example value for display */
  example: string;
  category: MergeVarCategory;
  /** Which email systems this variable is available in */
  usedIn: Array<'calendar' | 'marketing' | 'transactional'>;
}

// ── Canonical variable list ───────────────────────────────────────────────────

export const SYSTEM_MERGE_VARIABLES: SystemMergeVar[] = [
  // Contact
  { key: 'contact.first_name',          tag: '{{contact.first_name}}',          description: "Contact's first name",                   example: 'Sarah',                          category: 'contact',      usedIn: ['calendar', 'marketing', 'transactional'] },
  { key: 'contact.last_name',           tag: '{{contact.last_name}}',           description: "Contact's last name",                    example: 'Johnson',                        category: 'contact',      usedIn: ['calendar', 'marketing', 'transactional'] },
  { key: 'contact.full_name',           tag: '{{contact.full_name}}',           description: "Contact's full name",                    example: 'Sarah Johnson',                  category: 'contact',      usedIn: ['calendar', 'marketing', 'transactional'] },
  { key: 'contact.name',                tag: '{{contact.name}}',                description: "Contact's full name (alias)",            example: 'Sarah Johnson',                  category: 'contact',      usedIn: ['calendar', 'marketing', 'transactional'] },
  { key: 'contact.email',               tag: '{{contact.email}}',               description: "Contact's email address",                example: 'sarah@example.com',              category: 'contact',      usedIn: ['calendar', 'marketing', 'transactional'] },
  { key: 'contact.phone',               tag: '{{contact.phone}}',               description: "Contact's phone number",                 example: '+1 555-123-4567',                category: 'contact',      usedIn: ['calendar', 'marketing', 'transactional'] },
  // Appointment
  { key: 'appointment.title',           tag: '{{appointment.title}}',           description: 'Appointment title',                      example: 'Venue Tour',                     category: 'appointment',  usedIn: ['calendar'] },
  { key: 'appointment.date',            tag: '{{appointment.date}}',            description: 'Date only (e.g. Monday, May 5, 2026)',    example: 'Monday, May 5, 2026',            category: 'appointment',  usedIn: ['calendar'] },
  { key: 'appointment.time',            tag: '{{appointment.time}}',            description: 'Time only (e.g. 2:00 PM)',                example: '2:00 PM',                        category: 'appointment',  usedIn: ['calendar'] },
  { key: 'appointment.start_time',      tag: '{{appointment.start_time}}',      description: 'Full start date & time',                 example: 'Monday, May 5 at 2:00 PM',       category: 'appointment',  usedIn: ['calendar'] },
  { key: 'appointment.end_time',        tag: '{{appointment.end_time}}',        description: 'Full end date & time',                   example: 'Monday, May 5 at 3:00 PM',       category: 'appointment',  usedIn: ['calendar'] },
  { key: 'appointment.duration',        tag: '{{appointment.duration}}',        description: 'Duration (e.g. 1 hour, 30 minutes)',      example: '1 hour',                         category: 'appointment',  usedIn: ['calendar'] },
  { key: 'appointment.timezone',        tag: '{{appointment.timezone}}',        description: 'Timezone abbreviation (e.g. EST)',        example: 'EST',                            category: 'appointment',  usedIn: ['calendar'] },
  { key: 'appointment.meeting_location',tag: '{{appointment.meeting_location}}',description: 'Meeting link or physical address',        example: 'https://zoom.us/j/123456',       category: 'appointment',  usedIn: ['calendar'] },
  { key: 'appointment.calendar_name',   tag: '{{appointment.calendar_name}}',   description: 'Calendar name (e.g. Tour Calendar)',      example: 'Tour Calendar',                  category: 'appointment',  usedIn: ['calendar'] },
  { key: 'appointment.status',          tag: '{{appointment.status}}',          description: 'Status (confirmed / cancelled)',          example: 'confirmed',                      category: 'appointment',  usedIn: ['calendar'] },
  // Venue
  { key: 'venue.name',                  tag: '{{venue.name}}',                  description: 'Venue / business name',                  example: 'The Grand Ballroom',             category: 'venue',        usedIn: ['calendar', 'marketing', 'transactional'] },
  { key: 'venue.owner_name',            tag: '{{venue.owner_name}}',            description: "Owner's full name",                      example: 'Jason Westbrook',                category: 'venue',        usedIn: ['calendar', 'marketing', 'transactional'] },
  { key: 'venue.owner_first_name',      tag: '{{venue.owner_first_name}}',      description: "Owner's first name",                     example: 'Jason',                          category: 'venue',        usedIn: ['calendar', 'marketing', 'transactional'] },
  { key: 'venue.email',                 tag: '{{venue.email}}',                 description: "Venue's contact email",                  example: 'hello@yourvenue.com',            category: 'venue',        usedIn: ['calendar', 'marketing', 'transactional'] },
  { key: 'venue.phone',                 tag: '{{venue.phone}}',                 description: "Venue's phone number",                   example: '+1 555-987-6543',                category: 'venue',        usedIn: ['calendar', 'marketing'] },
  { key: 'venue.address',               tag: '{{venue.address}}',               description: 'Full venue address',                     example: '123 Main St, Nashville, TN',     category: 'venue',        usedIn: ['calendar', 'marketing'] },
  { key: 'venue.city',                  tag: '{{venue.city}}',                  description: 'Venue city',                             example: 'Nashville',                      category: 'venue',        usedIn: ['calendar', 'marketing'] },
  { key: 'venue.state',                 tag: '{{venue.state}}',                 description: 'Venue state',                            example: 'TN',                             category: 'venue',        usedIn: ['calendar', 'marketing'] },
  { key: 'venue.website',               tag: '{{venue.website}}',               description: 'Venue website URL',                      example: 'https://yourvenue.com',          category: 'venue',        usedIn: ['calendar', 'marketing'] },
  // Lead
  { key: 'lead.wedding_date',           tag: '{{lead.wedding_date}}',           description: 'Wedding date (formatted)',                example: 'October 15, 2027',               category: 'lead',         usedIn: ['marketing'] },
  { key: 'lead.wedding_month',          tag: '{{lead.wedding_month}}',          description: 'Wedding month name',                     example: 'October',                        category: 'lead',         usedIn: ['marketing'] },
  { key: 'lead.guest_count',            tag: '{{lead.guest_count}}',            description: 'Estimated guest count',                  example: '150',                            category: 'lead',         usedIn: ['marketing'] },
  // Payment (transactional — amount received, fees, failure reason, etc.)
  { key: 'payment.amount',              tag: '{{payment.amount}}',              description: 'Payment amount',                         example: '$4,500.00',                      category: 'payment',      usedIn: ['transactional'] },
  { key: 'payment.net_amount',          tag: '{{payment.net_amount}}',          description: 'Net amount after processing fees',       example: '$4,376.25',                      category: 'payment',      usedIn: ['transactional'] },
  { key: 'payment.fee',                 tag: '{{payment.fee}}',                 description: 'Processing fee amount',                  example: '$123.75',                        category: 'payment',      usedIn: ['transactional'] },
  { key: 'payment.method',              tag: '{{payment.method}}',              description: 'Payment method (card / ACH)',             example: 'Visa ••••4242',                  category: 'payment',      usedIn: ['transactional'] },
  { key: 'payment.date',                tag: '{{payment.date}}',                description: 'Date payment was made',                  example: 'April 30, 2026',                 category: 'payment',      usedIn: ['transactional'] },
  { key: 'payment.reason',              tag: '{{payment.reason}}',              description: 'Failure reason (failed-payment emails)', example: 'Insufficient funds',             category: 'payment',      usedIn: ['transactional'] },
  { key: 'payment.overdue_by',          tag: '{{payment.overdue_by}}',          description: 'How long since the due date',            example: '3 days',                         category: 'payment',      usedIn: ['transactional'] },
  // Invoice
  { key: 'invoice.number',              tag: '{{invoice.number}}',              description: 'Invoice number',                         example: 'INV-0042',                       category: 'invoice',      usedIn: ['transactional'] },
  { key: 'invoice.amount',              tag: '{{invoice.amount}}',              description: 'Invoice total amount',                   example: '$2,500.00',                      category: 'invoice',      usedIn: ['transactional'] },
  { key: 'invoice.due_date',            tag: '{{invoice.due_date}}',            description: 'Invoice due date',                       example: 'May 15, 2026',                   category: 'invoice',      usedIn: ['transactional'] },
  { key: 'invoice.date',                tag: '{{invoice.date}}',                description: 'Date invoice was paid',                  example: 'April 30, 2026',                 category: 'invoice',      usedIn: ['transactional'] },
  { key: 'invoice.payment_method',      tag: '{{invoice.payment_method}}',      description: 'Payment method used',                    example: 'Visa ending 4242',               category: 'invoice',      usedIn: ['transactional'] },
  // Proposal
  { key: 'proposal.title',              tag: '{{proposal.title}}',              description: 'Proposal title',                         example: 'Wedding Package Proposal',       category: 'proposal',     usedIn: ['transactional'] },
  { key: 'proposal.amount',             tag: '{{proposal.amount}}',             description: 'Proposal total amount',                  example: '$8,500.00',                      category: 'proposal',     usedIn: ['transactional'] },
  // Subscription
  { key: 'subscription.amount',         tag: '{{subscription.amount}}',         description: 'Subscription amount',                    example: '$99.00/mo',                      category: 'subscription', usedIn: ['transactional'] },
  { key: 'subscription.frequency',      tag: '{{subscription.frequency}}',      description: 'Billing cycle',                          example: 'monthly',                        category: 'subscription', usedIn: ['transactional'] },
  { key: 'subscription.next_payment_date', tag: '{{subscription.next_payment_date}}', description: 'Next charge date',               example: 'June 1, 2026',                   category: 'subscription', usedIn: ['transactional'] },
  // Marketing
  { key: 'marketing.unsubscribe_url',   tag: '{{marketing.unsubscribe_url}}',   description: 'One-click unsubscribe link',              example: 'https://app.storypay.io/u/…',    category: 'marketing',    usedIn: ['marketing'] },
  { key: 'marketing.resubscribe_url',   tag: '{{marketing.resubscribe_url}}',   description: 'Resubscribe link',                       example: 'https://app.storypay.io/u/…',    category: 'marketing',    usedIn: ['marketing'] },
  { key: 'marketing.preferences_url',   tag: '{{marketing.preferences_url}}',   description: 'Manage email preferences link',          example: 'https://app.storypay.io/u/…',    category: 'marketing',    usedIn: ['marketing'] },
  // System
  { key: 'system.date',                 tag: '{{system.date}}',                 description: "Today's date at send time",              example: 'April 30, 2026',                 category: 'system',       usedIn: ['calendar', 'marketing', 'transactional'] },
  { key: 'system.year',                 tag: '{{system.year}}',                 description: 'Current year at send time',              example: '2026',                           category: 'system',       usedIn: ['calendar', 'marketing', 'transactional'] },
];

// ── Legacy flat alias bridges ─────────────────────────────────────────────────
// Maps old flat/underscore keys → canonical dot-notation keys.
// Keeps every existing template working without migration.

export const FLAT_TO_CANONICAL: Record<string, string> = {
  // ── Contact ───────────────────────────────────────────────────────────────
  customer_name:            'contact.name',
  customer_email:           'contact.email',
  customer_phone:           'contact.phone',
  first_name:               'contact.first_name',
  last_name:                'contact.last_name',
  contact_name:             'contact.name',
  contact_email:            'contact.email',
  contact_phone:            'contact.phone',
  // ── Venue ─────────────────────────────────────────────────────────────────
  organization:             'venue.name',
  venue_name:               'venue.name',
  venue_email:              'venue.email',
  venue_phone:              'venue.phone',
  venue_full_address:       'venue.address',
  venue_city:               'venue.city',
  venue_state:              'venue.state',
  venue_website:            'venue.website',
  venue_owner_name:         'venue.owner_name',
  venue_owner_first_name:   'venue.owner_first_name',
  // ── Payment (transactional) ───────────────────────────────────────────────
  amount:                   'payment.amount',
  net_amount:               'payment.net_amount',
  fee:                      'payment.fee',
  payment_method:           'payment.method',
  date:                     'payment.date',
  reason:                   'payment.reason',
  offset_label:             'payment.overdue_by',
  // ── Invoice ───────────────────────────────────────────────────────────────
  invoice_number:           'invoice.number',
  invoice_amount:           'invoice.amount',
  due_date:                 'invoice.due_date',
  invoice_date:             'invoice.date',
  // ── Subscription ─────────────────────────────────────────────────────────
  frequency:                'subscription.frequency',
  next_payment_date:        'subscription.next_payment_date',
  // ── Marketing ────────────────────────────────────────────────────────────
  unsubscribe_url:          'marketing.unsubscribe_url',
  resubscribe_url:          'marketing.resubscribe_url',
  manage_prefs_url:         'marketing.preferences_url',
  preferences_url:          'marketing.preferences_url',
  // ── Lead / Event ─────────────────────────────────────────────────────────
  wedding_date:             'lead.wedding_date',
  wedding_date_nice:        'lead.wedding_date',
  wedding_month:            'lead.wedding_month',
  guest_count:              'lead.guest_count',
};

// Reverse map: canonical → primary flat alias (first one wins)
export const CANONICAL_TO_FLAT: Record<string, string> = {};
for (const [flat, canonical] of Object.entries(FLAT_TO_CANONICAL)) {
  if (!CANONICAL_TO_FLAT[canonical]) CANONICAL_TO_FLAT[canonical] = flat;
}

// ── Universal renderer ────────────────────────────────────────────────────────

/**
 * Resolves {{tags}} in a template string against a vars record.
 *
 * Resolution order per tag:
 *  1. Direct match — key exists in vars as-is
 *  2. Flat → canonical — e.g. {{customer_name}} resolves via contact.name
 *  3. Canonical → flat — e.g. {{contact.name}} resolves via customer_name
 *  4. Empty string (never leaves an unresolved {{tag}} in the output)
 */
export function renderMergeVars(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, rawKey: string) => {
    const key = rawKey.trim();
    if (vars[key] !== undefined && vars[key] !== null) return vars[key];
    const canonical = FLAT_TO_CANONICAL[key];
    if (canonical && vars[canonical] !== undefined) return vars[canonical];
    const flatKey = CANONICAL_TO_FLAT[key];
    if (flatKey && vars[flatKey] !== undefined) return vars[flatKey];
    return '';
  });
}

// ── System date helpers ───────────────────────────────────────────────────────

export function systemDateVars(): { 'system.date': string; 'system.year': string } {
  const now = new Date();
  return {
    'system.date': now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    'system.year': String(now.getFullYear()),
  };
}

// ── Transactional var enricher ────────────────────────────────────────────────

/**
 * Takes a flat vars dict (as used in all transactional email sends) and adds
 * canonical dot-notation equivalents alongside every flat key — plus derives
 * missing first/last name splits from customer_name.
 *
 * Call this once per send; renderMergeVars resolves both directions already,
 * but enriching up-front means {{contact.first_name}}, {{payment.amount}} etc.
 * all resolve as direct matches (fastest path) regardless of which naming
 * convention the template author used.
 */
export function enrichTransactionalVars(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...vars };

  // Derive canonical keys from every flat key present
  for (const [flat, canonical] of Object.entries(FLAT_TO_CANONICAL)) {
    if (out[flat] !== undefined && out[canonical] === undefined) {
      out[canonical] = out[flat];
    }
  }

  // Derive flat keys from any canonical keys that are already set
  for (const [canonical, flat] of Object.entries(CANONICAL_TO_FLAT)) {
    if (out[canonical] !== undefined && out[flat] === undefined) {
      out[flat] = out[canonical];
    }
  }

  // Split contact full-name into first/last if the parts are missing
  const fullName = out['contact.name'] || out['contact.full_name'] || out['customer_name'] || '';
  if (fullName && !out['contact.first_name']) {
    const parts = fullName.trim().split(/\s+/);
    out['contact.first_name'] = parts[0] || '';
    out['contact.last_name']  = parts.slice(1).join(' ') || '';
    // Also set flat equivalents
    if (!out['first_name']) out['first_name'] = out['contact.first_name'];
    if (!out['last_name'])  out['last_name']  = out['contact.last_name'];
  }

  // contact.full_name ↔ contact.name should always be in sync
  if (out['contact.name'] && !out['contact.full_name'])  out['contact.full_name'] = out['contact.name'];
  if (out['contact.full_name'] && !out['contact.name'])  out['contact.name'] = out['contact.full_name'];

  // payment.amount should also be available as invoice.amount and vice-versa
  // (same dollar figure, different context labels)
  if (out['payment.amount'] && !out['invoice.amount']) out['invoice.amount'] = out['payment.amount'];
  if (out['invoice.amount'] && !out['payment.amount']) out['payment.amount'] = out['invoice.amount'];

  return out;
}
