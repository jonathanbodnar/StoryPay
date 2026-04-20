-- LunarPay customer id under StoryPay platform merchant (directory SaaS billing).

BEGIN;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS platform_lunarpay_customer_id text;

COMMENT ON COLUMN public.venues.platform_lunarpay_customer_id IS 'LunarPay customer id on STORYPAY_PLATFORM_LUNARPAY_* merchant for directory subscription billing.';

COMMIT;

NOTIFY pgrst, 'reload schema';
