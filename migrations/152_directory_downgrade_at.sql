-- 152_directory_downgrade_at.sql
-- Deferred downgrade-to-Free for the card-gated trial model.
--
-- When a venue cancels (or a renewal card finally fails after dunning), we do
-- NOT cut them off immediately. We stamp `directory_downgrade_at` with the end
-- of their current paid/trial period. The trial-sweep cron then moves them to
-- the Free plan at that time (listing + payment processing stay on, automated
-- Bride Booking System switches off). Cleared when a charge succeeds.
--
-- We also track trial-ending reminder sends so the sweep doesn't re-notify.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS directory_downgrade_at timestamptz,
  ADD COLUMN IF NOT EXISTS directory_trial_reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS directory_dunning_started_at timestamptz,
  -- Throttle for the Free-tier win-back nudge (a lead landed but the paid
  -- Booking System is off). At most one nudge per cooldown window.
  ADD COLUMN IF NOT EXISTS directory_winback_nudged_at timestamptz;

-- Helps the sweep find due rows quickly.
CREATE INDEX IF NOT EXISTS idx_venues_directory_downgrade_at
  ON public.venues (directory_downgrade_at)
  WHERE directory_downgrade_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_venues_directory_trial_ends_at
  ON public.venues (directory_trial_ends_at)
  WHERE directory_trial_ends_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
