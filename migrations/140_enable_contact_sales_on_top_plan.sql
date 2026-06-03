-- Migration 140: ensure contact_sales column exists and enable it on the
-- highest-priced plan (All-inclusive / $997/mo tier).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + idempotent UPDATE.

ALTER TABLE public.directory_plans
  ADD COLUMN IF NOT EXISTS contact_sales BOOLEAN NOT NULL DEFAULT FALSE;

-- Enable contact_sales on the most expensive plan (highest price_monthly_cents).
-- This replaces the self-serve upgrade CTA with a "Book a Demo Call" button.
UPDATE public.directory_plans
   SET contact_sales = TRUE
 WHERE id = (
   SELECT id
     FROM public.directory_plans
    WHERE COALESCE(price_monthly_cents, 0) = (
            SELECT MAX(COALESCE(price_monthly_cents, 0))
              FROM public.directory_plans
          )
    ORDER BY sort_order ASC
    LIMIT 1
 );

SELECT pg_notify('pgrst', 'reload schema');
