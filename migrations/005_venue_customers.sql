-- ============================================================================
-- 005_venue_customers.sql
--
-- Adds the StoryPay-native customer / CRM profile table to the LIVE Supabase
-- project (brnxhsaakmhgwcthcapd). This is what /api/customers and
-- /api/venue-customers write to, so customer creation works even before a
-- venue has connected LunarPay or GoHighLevel.
--
-- Idempotent — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.venue_customers (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id             uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  customer_email       text        NOT NULL,

  -- Basic contact
  first_name           text        NOT NULL DEFAULT '',
  last_name            text        NOT NULL DEFAULT '',
  phone                text,

  -- External IDs (populated when synced to LunarPay / GHL)
  ghl_contact_id       text,
  lunarpay_customer_id text,

  -- Partner / second contact (couples)
  partner_first_name   text,
  partner_last_name    text,
  partner_email        text,
  partner_phone        text,

  -- Wedding details
  wedding_date         date,
  wedding_space_id     uuid,
  ceremony_type        text,
  guest_count          integer,
  rehearsal_date       date,
  coordinator_name     text,
  coordinator_phone    text,
  catering_notes       text,

  -- Pipeline / lead origin
  referral_source      text,
  pipeline_stage       text        NOT NULL DEFAULT 'inquiry',
  tags                 text[],

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  UNIQUE (venue_id, customer_email)
);

CREATE INDEX IF NOT EXISTS venue_customers_venue_id_idx ON public.venue_customers (venue_id);
CREATE INDEX IF NOT EXISTS venue_customers_email_idx    ON public.venue_customers (customer_email);

-- Keep updated_at fresh on every update
DROP TRIGGER IF EXISTS trg_venue_customers_updated_at ON public.venue_customers;
CREATE TRIGGER trg_venue_customers_updated_at
  BEFORE UPDATE ON public.venue_customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS — server uses service_role so policies below only affect direct client access
ALTER TABLE public.venue_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can read venue customers" ON public.venue_customers;
CREATE POLICY "Owners can read venue customers" ON public.venue_customers
  FOR SELECT USING (
    venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "Owners can write venue customers" ON public.venue_customers;
CREATE POLICY "Owners can write venue customers" ON public.venue_customers
  FOR ALL USING (
    venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
  ) WITH CHECK (
    venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_customers TO service_role, authenticated;

NOTIFY pgrst, 'reload schema';
