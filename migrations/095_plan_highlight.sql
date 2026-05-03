-- Migration 095: plan highlight label
-- Allows a plan to carry a short promotional badge label (e.g. "Recommended",
-- "Most Popular", "Best Value") that is displayed on the public plan picker
-- and the dashboard billing/upgrade accordion.
-- NULL = no badge.  Set a short string (<= 40 chars) to enable.

ALTER TABLE public.directory_plans
  ADD COLUMN IF NOT EXISTS highlight_label TEXT NULL DEFAULT NULL;

COMMENT ON COLUMN public.directory_plans.highlight_label IS
  'Short badge label shown on plan cards (e.g. "Recommended", "Most Popular"). NULL = no badge.';

NOTIFY pgrst, 'reload schema';
