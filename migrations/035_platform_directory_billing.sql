-- Platform (StoryPay) directory billing: Fortis merchant on plans, venue subscription state, cash events for admin reporting.

BEGIN;

ALTER TABLE public.directory_plans
  ADD COLUMN IF NOT EXISTS fortis_merchant_id text;

COMMENT ON COLUMN public.directory_plans.fortis_merchant_id IS 'Optional Fortis merchant id for this plan; when NULL, server uses STORYPAY_PLATFORM_FORTIS_MERCHANT_ID.';

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS directory_subscription_status text NOT NULL DEFAULT 'none';

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS directory_subscription_external_id text;

COMMENT ON COLUMN public.venues.directory_subscription_status IS 'StoryPay SaaS subscription: none, pending, active, past_due, canceled, trialing.';
COMMENT ON COLUMN public.venues.directory_subscription_external_id IS 'External subscription id (e.g. LunarPay) when recurring billing is wired.';

CREATE TABLE IF NOT EXISTS public.platform_billing_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id             uuid REFERENCES public.venues(id) ON DELETE SET NULL,
  directory_plan_id    uuid REFERENCES public.directory_plans(id) ON DELETE SET NULL,
  amount_cents         int         NOT NULL,
  currency             text        NOT NULL DEFAULT 'usd',
  fortis_merchant_id   text,
  external_event_id    text,
  event_type           text        NOT NULL,
  occurred_at          timestamptz NOT NULL DEFAULT now(),
  metadata             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_billing_events_occurred_idx
  ON public.platform_billing_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS platform_billing_events_venue_idx
  ON public.platform_billing_events (venue_id);

COMMENT ON TABLE public.platform_billing_events IS 'Cash movements for StoryPay→venue SaaS billing (charges/refunds); ingest via webhook or internal jobs.';

ALTER TABLE public.platform_billing_events DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_billing_events TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
