-- SMS compliance (TCPA-style STOP) + automation step type send_sms

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS sms_dnd boolean NOT NULL DEFAULT false;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS sms_dnd_at timestamptz;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS sms_dnd_source text;

COMMENT ON COLUMN public.leads.sms_dnd IS
  'When true, do not send marketing/automated SMS; set by inbound STOP keywords or manually.';

ALTER TABLE public.venue_customers
  ADD COLUMN IF NOT EXISTS sms_dnd boolean NOT NULL DEFAULT false;

ALTER TABLE public.venue_customers
  ADD COLUMN IF NOT EXISTS sms_dnd_at timestamptz;

ALTER TABLE public.venue_customers
  ADD COLUMN IF NOT EXISTS sms_dnd_source text;

COMMENT ON COLUMN public.venue_customers.sms_dnd IS
  'When true, do not send marketing/automated SMS to this profile.';

-- Extend automation steps: plain-text SMS via GHL (body in config_json)
ALTER TABLE public.marketing_automation_steps
  DROP CONSTRAINT IF EXISTS marketing_automation_steps_type_chk;

ALTER TABLE public.marketing_automation_steps
  ADD CONSTRAINT marketing_automation_steps_type_chk CHECK (
    step_type IN ('delay', 'send_email', 'send_sms')
  );

CREATE INDEX IF NOT EXISTS leads_venue_sms_dnd_idx
  ON public.leads (venue_id, sms_dnd)
  WHERE sms_dnd = true;

CREATE INDEX IF NOT EXISTS venue_customers_venue_sms_dnd_idx
  ON public.venue_customers (venue_id, sms_dnd)
  WHERE sms_dnd = true;

NOTIFY pgrst, 'reload schema';
