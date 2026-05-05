-- Migration 106: Add hide_header to directory_plans
-- When true, the plan picker page renders without the top navigation/
-- step header, allowing the plan to serve as a standalone landing page.

ALTER TABLE public.directory_plans
  ADD COLUMN IF NOT EXISTS hide_header BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.directory_plans.hide_header IS
  'When true the plan picker page hides the top header so the plan cards
   appear as a standalone landing page. Useful for direct-link campaigns.';

NOTIFY pgrst, 'reload schema';
