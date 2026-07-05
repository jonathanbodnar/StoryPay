-- Migration 160: Venue owner suspension
-- Allows super admins to block a churned owner's login without deleting data.
-- Fully reversible. Super admin impersonation is unaffected (uses service role).

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspended_at  timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by  text;

NOTIFY pgrst, 'reload schema';
