-- Migration 139: add contact_sales flag to directory_plans
-- When true the plan's price is hidden in the venue billing UI and the
-- upgrade CTA is replaced with a "Book a Strategy Call" button. Venues
-- already subscribed to the plan still see full self-serve management.
ALTER TABLE public.directory_plans
  ADD COLUMN IF NOT EXISTS contact_sales BOOLEAN NOT NULL DEFAULT FALSE;

SELECT pg_notify('pgrst', 'reload schema');
