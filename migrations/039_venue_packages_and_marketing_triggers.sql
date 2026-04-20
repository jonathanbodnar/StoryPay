-- Venue quote packages (bundled products + seasonal windows) and extended marketing automation triggers.

CREATE TABLE IF NOT EXISTS public.venue_packages (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id                uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name                    text        NOT NULL,
  description             text,
  season_label            text,
  valid_from              date,
  valid_to                date,
  minimum_subtotal_cents  int         NOT NULL DEFAULT 0 CHECK (minimum_subtotal_cents >= 0),
  sort_order              int         NOT NULL DEFAULT 0,
  active                  boolean     NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.venue_package_lines (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id             uuid        NOT NULL REFERENCES public.venue_packages(id) ON DELETE CASCADE,
  product_id             uuid        NOT NULL REFERENCES public.venue_products(id) ON DELETE CASCADE,
  quantity               int         NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  price_override_cents   int         CHECK (price_override_cents IS NULL OR price_override_cents >= 0),
  sort_order             int         NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS venue_packages_venue_id_idx ON public.venue_packages (venue_id);
CREATE INDEX IF NOT EXISTS venue_packages_venue_active_idx ON public.venue_packages (venue_id, active);
CREATE INDEX IF NOT EXISTS venue_package_lines_package_id_idx ON public.venue_package_lines (package_id);

COMMENT ON TABLE public.venue_packages IS 'Preset bundles for proposals/invoices; lines reference venue_products. Price is sum of lines unless overridden per line.';
COMMENT ON COLUMN public.venue_packages.minimum_subtotal_cents IS 'Enforced in UI when applying package; subtotal must meet minimum before send.';

ALTER TABLE public.venue_packages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_package_lines DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_packages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_package_lines TO service_role;

ALTER TABLE public.marketing_automations DROP CONSTRAINT IF EXISTS marketing_automations_trigger_chk;
ALTER TABLE public.marketing_automations ADD CONSTRAINT marketing_automations_trigger_chk CHECK (
  trigger_type IN (
    'tag_added',
    'stage_changed',
    'trigger_link_click',
    'wedding_date_followup',
    'proposal_paid'
  )
);

COMMENT ON COLUMN public.marketing_automations.trigger_type IS
  'wedding_date_followup: trigger_config.days_after_wedding (int). proposal_paid: enroll when proposal marked paid (lead matched by email).';

NOTIFY pgrst, 'reload schema';
