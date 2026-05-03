-- Migration 094: plan visibility
-- Adds is_public flag to directory_plans so admins can hide legacy or
-- internal plans from the public-facing plan picker and upgrade modals
-- without deleting them.

ALTER TABLE public.directory_plans
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.directory_plans.is_public IS
  'When false, this plan is hidden from the public plan picker, signup flow, and upgrade modals. Existing subscribers keep their plan unaffected.';

NOTIFY pgrst, 'reload schema';
