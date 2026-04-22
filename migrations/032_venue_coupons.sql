-- Venue-scoped discount coupons for proposals and invoices (line-item discounts).
-- Idempotent; safe to re-run. Proposals-related FK / columns only attach if the
-- proposals table exists in this database.

CREATE TABLE IF NOT EXISTS public.venue_coupons (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id              uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  code                  text        NOT NULL,
  name                  text        NOT NULL,
  description           text,
  discount_type         text        NOT NULL CHECK (discount_type IN ('percent', 'fixed_cents')),
  discount_percent      numeric(7, 4),
  discount_amount_cents int,
  max_redemptions       int,
  uses_count            int         NOT NULL DEFAULT 0,
  active                boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_coupons_percent_chk CHECK (
    discount_type <> 'percent' OR (discount_percent IS NOT NULL AND discount_percent > 0 AND discount_percent <= 100)
  ),
  CONSTRAINT venue_coupons_fixed_chk CHECK (
    discount_type <> 'fixed_cents' OR (discount_amount_cents IS NOT NULL AND discount_amount_cents > 0)
  ),
  CONSTRAINT venue_coupons_uses_chk CHECK (uses_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS venue_coupons_venue_code_lower_idx
  ON public.venue_coupons (venue_id, lower(code));

CREATE INDEX IF NOT EXISTS venue_coupons_venue_id_idx ON public.venue_coupons (venue_id);

COMMENT ON TABLE public.venue_coupons IS 'max_redemptions NULL = unlimited; 1 = one-time; N = limited uses.';

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id       uuid        NOT NULL REFERENCES public.venue_coupons(id) ON DELETE CASCADE,
  venue_id        uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  proposal_id     uuid,
  discount_cents  int         NOT NULL CHECK (discount_cents >= 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_id_idx ON public.coupon_redemptions (coupon_id);
CREATE INDEX IF NOT EXISTS coupon_redemptions_proposal_id_idx ON public.coupon_redemptions (proposal_id);

-- Only attach proposals FK / columns if the proposals table is present in this DB.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'proposals'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'coupon_redemptions'
        AND constraint_name = 'coupon_redemptions_proposal_id_fkey'
    ) THEN
      ALTER TABLE public.coupon_redemptions
        ADD CONSTRAINT coupon_redemptions_proposal_id_fkey
        FOREIGN KEY (proposal_id) REFERENCES public.proposals(id) ON DELETE SET NULL;
    END IF;

    ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS line_items jsonb;
    ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS applied_coupon_id uuid;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'proposals'
        AND constraint_name = 'proposals_applied_coupon_id_fkey'
    ) THEN
      ALTER TABLE public.proposals
        ADD CONSTRAINT proposals_applied_coupon_id_fkey
        FOREIGN KEY (applied_coupon_id) REFERENCES public.venue_coupons(id) ON DELETE SET NULL;
    END IF;

    COMMENT ON COLUMN public.proposals.line_items IS 'Snapshot of line items (name, description, amount cents, flags) when created from payments/new.';
  END IF;
END $$;

ALTER TABLE public.venue_coupons DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_redemptions DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_coupons TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupon_redemptions TO service_role;

NOTIFY pgrst, 'reload schema';
