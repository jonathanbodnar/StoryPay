-- ─────────────────────────────────────────────────────────────────────────────
-- 083 · System merge variables registry
-- ─────────────────────────────────────────────────────────────────────────────
-- Read-only canonical variable list. Rows are system-seeded and non-deletable.
-- Custom venue variables can be added with is_system = false.

CREATE TABLE IF NOT EXISTS public.system_merge_variables (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text        NOT NULL UNIQUE,          -- e.g. "contact.first_name"
  tag         text        NOT NULL,                 -- e.g. "{{contact.first_name}}"
  description text        NOT NULL,
  example     text        NOT NULL DEFAULT '',
  category    text        NOT NULL,
  used_in     text[]      NOT NULL DEFAULT '{}',    -- ['calendar','marketing','transactional']
  is_system   boolean     NOT NULL DEFAULT true,    -- true = cannot be deleted via UI
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Prevent accidental deletion of system rows
CREATE OR REPLACE RULE no_delete_system_vars AS
  ON DELETE TO public.system_merge_variables
  WHERE OLD.is_system = true
  DO INSTEAD NOTHING;

-- ── Seed canonical variables ─────────────────────────────────────────────────
INSERT INTO public.system_merge_variables (key, tag, description, example, category, used_in, sort_order) VALUES
  -- Contact
  ('contact.first_name',           '{{contact.first_name}}',           'Contact''s first name',                   'Sarah',                       'contact',      ARRAY['calendar','marketing','transactional'], 10),
  ('contact.last_name',            '{{contact.last_name}}',            'Contact''s last name',                    'Johnson',                     'contact',      ARRAY['calendar','marketing','transactional'], 11),
  ('contact.name',                 '{{contact.name}}',                 'Contact''s full name',                    'Sarah Johnson',               'contact',      ARRAY['calendar','marketing','transactional'], 12),
  ('contact.email',                '{{contact.email}}',                'Contact''s email address',                'sarah@example.com',           'contact',      ARRAY['calendar','marketing','transactional'], 13),
  ('contact.phone',                '{{contact.phone}}',                'Contact''s phone number',                 '+1 555-123-4567',             'contact',      ARRAY['calendar','marketing'],                 14),
  -- Appointment
  ('appointment.title',            '{{appointment.title}}',            'Appointment title',                       'Venue Tour',                  'appointment',  ARRAY['calendar'],                             20),
  ('appointment.date',             '{{appointment.date}}',             'Date only (e.g. Monday, May 5, 2026)',    'Monday, May 5, 2026',         'appointment',  ARRAY['calendar'],                             21),
  ('appointment.time',             '{{appointment.time}}',             'Time only (e.g. 2:00 PM)',                '2:00 PM',                     'appointment',  ARRAY['calendar'],                             22),
  ('appointment.start_time',       '{{appointment.start_time}}',       'Full start date & time',                  'Monday, May 5 at 2:00 PM',    'appointment',  ARRAY['calendar'],                             23),
  ('appointment.end_time',         '{{appointment.end_time}}',         'Full end date & time',                    'Monday, May 5 at 3:00 PM',    'appointment',  ARRAY['calendar'],                             24),
  ('appointment.duration',         '{{appointment.duration}}',         'Duration (e.g. 1 hour, 30 minutes)',      '1 hour',                      'appointment',  ARRAY['calendar'],                             25),
  ('appointment.timezone',         '{{appointment.timezone}}',         'Timezone abbreviation (e.g. EST)',        'EST',                         'appointment',  ARRAY['calendar'],                             26),
  ('appointment.meeting_location', '{{appointment.meeting_location}}', 'Meeting link or physical address',        'https://zoom.us/j/123456',    'appointment',  ARRAY['calendar'],                             27),
  ('appointment.calendar_name',    '{{appointment.calendar_name}}',    'Calendar name (e.g. Tour Calendar)',      'Tour Calendar',               'appointment',  ARRAY['calendar'],                             28),
  ('appointment.status',           '{{appointment.status}}',           'Status (confirmed / cancelled)',          'confirmed',                   'appointment',  ARRAY['calendar'],                             29),
  -- Venue
  ('venue.name',                   '{{venue.name}}',                   'Venue / business name',                   'The Grand Ballroom',          'venue',        ARRAY['calendar','marketing','transactional'], 30),
  ('venue.owner_name',             '{{venue.owner_name}}',             'Owner''s full name',                      'Jason Westbrook',             'venue',        ARRAY['calendar','marketing','transactional'], 31),
  ('venue.owner_first_name',       '{{venue.owner_first_name}}',       'Owner''s first name',                     'Jason',                       'venue',        ARRAY['calendar','marketing','transactional'], 32),
  ('venue.email',                  '{{venue.email}}',                  'Venue''s contact email',                  'hello@yourvenue.com',         'venue',        ARRAY['calendar','marketing','transactional'], 33),
  ('venue.phone',                  '{{venue.phone}}',                  'Venue''s phone number',                   '+1 555-987-6543',             'venue',        ARRAY['calendar','marketing'],                 34),
  ('venue.address',                '{{venue.address}}',                'Full venue address',                      '123 Main St, Nashville, TN',  'venue',        ARRAY['calendar','marketing'],                 35),
  ('venue.city',                   '{{venue.city}}',                   'Venue city',                              'Nashville',                   'venue',        ARRAY['calendar','marketing'],                 36),
  ('venue.state',                  '{{venue.state}}',                  'Venue state',                             'TN',                          'venue',        ARRAY['calendar','marketing'],                 37),
  ('venue.website',                '{{venue.website}}',                'Venue website URL',                       'https://yourvenue.com',       'venue',        ARRAY['calendar','marketing'],                 38),
  -- Lead
  ('lead.wedding_date',            '{{lead.wedding_date}}',            'Wedding date (formatted)',                 'October 15, 2027',            'lead',         ARRAY['marketing'],                            40),
  ('lead.wedding_month',           '{{lead.wedding_month}}',           'Wedding month name',                      'October',                     'lead',         ARRAY['marketing'],                            41),
  ('lead.guest_count',             '{{lead.guest_count}}',             'Estimated guest count',                   '150',                         'lead',         ARRAY['marketing'],                            42),
  -- Invoice
  ('invoice.number',               '{{invoice.number}}',               'Invoice number',                          'INV-0042',                    'invoice',      ARRAY['transactional'],                        50),
  ('invoice.amount',               '{{invoice.amount}}',               'Invoice amount',                          '$2,500.00',                   'invoice',      ARRAY['transactional'],                        51),
  ('invoice.due_date',             '{{invoice.due_date}}',             'Invoice due date',                        'May 15, 2026',                'invoice',      ARRAY['transactional'],                        52),
  ('invoice.date',                 '{{invoice.date}}',                 'Date invoice was paid',                   'April 30, 2026',              'invoice',      ARRAY['transactional'],                        53),
  ('invoice.payment_method',       '{{invoice.payment_method}}',       'Payment method used',                     'Visa ending 4242',            'invoice',      ARRAY['transactional'],                        54),
  -- Proposal
  ('proposal.title',               '{{proposal.title}}',               'Proposal title',                          'Wedding Package Proposal',    'proposal',     ARRAY['transactional'],                        60),
  ('proposal.amount',              '{{proposal.amount}}',              'Proposal total amount',                   '$8,500.00',                   'proposal',     ARRAY['transactional'],                        61),
  -- Subscription
  ('subscription.amount',          '{{subscription.amount}}',          'Subscription amount',                     '$99.00/mo',                   'subscription', ARRAY['transactional'],                        70),
  ('subscription.frequency',       '{{subscription.frequency}}',       'Billing cycle',                           'monthly',                     'subscription', ARRAY['transactional'],                        71),
  ('subscription.next_payment_date','{{subscription.next_payment_date}}','Next charge date',                      'June 1, 2026',                'subscription', ARRAY['transactional'],                        72),
  -- Marketing
  ('marketing.unsubscribe_url',    '{{marketing.unsubscribe_url}}',    'One-click unsubscribe link',              'https://…/unsubscribe',       'marketing',    ARRAY['marketing'],                            80),
  ('marketing.resubscribe_url',    '{{marketing.resubscribe_url}}',    'Resubscribe link',                        'https://…/resubscribe',       'marketing',    ARRAY['marketing'],                            81),
  ('marketing.preferences_url',    '{{marketing.preferences_url}}',    'Manage email preferences link',           'https://…/manage',            'marketing',    ARRAY['marketing'],                            82),
  -- System
  ('system.date',                  '{{system.date}}',                  'Today''s date at send time',              'April 30, 2026',              'system',       ARRAY['calendar','marketing','transactional'], 90),
  ('system.year',                  '{{system.year}}',                  'Current year at send time',               '2026',                        'system',       ARRAY['calendar','marketing','transactional'], 91)
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  example     = EXCLUDED.example,
  category    = EXCLUDED.category,
  used_in     = EXCLUDED.used_in,
  sort_order  = EXCLUDED.sort_order;

NOTIFY pgrst, 'reload schema';
