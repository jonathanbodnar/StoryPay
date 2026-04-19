-- Per-lead consent for venue marketing email (campaigns + automations).
-- Unsubscribe flow sets this to false alongside marketing_email_suppressions.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS marketing_email_opt_in boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.leads.marketing_email_opt_in IS
  'When false, venue marketing emails must not be sent (independent of suppression row; kept in sync on unsubscribe).';
