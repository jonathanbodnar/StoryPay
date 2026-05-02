-- Trial period support for directory plans.
--
-- Plans carry the *current* trial config (e.g. "14 days"). When a venue first
-- signs up for a paid plan, that trial config is SNAPSHOTTED onto the venue
-- so future admin edits to the plan never extend or shrink an active trial —
-- only new signups get the new value.
--
-- A trial does NOT create a LunarPay subscription. Instead the venue stays in
-- 'trialing' status until either:
--   • the trial ends without a card → status = 'trial_expired' (downgraded)
--   • the venue adds a card mid-trial → LunarPay subscription is created with
--     startOn = directory_trial_ends_at (delayed first charge)
--
-- For 'forever' trials, directory_trial_ends_at stays NULL and
-- directory_trial_is_forever is TRUE. These never auto-bill.

-- ── Plan-level trial config ────────────────────────────────────────────────

ALTER TABLE public.directory_plans
  ADD COLUMN IF NOT EXISTS trial_period_value INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trial_period_unit TEXT NOT NULL DEFAULT 'none';

-- Whitelist the unit values so a typo can't break the date math.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'directory_plans_trial_period_unit_check'
  ) THEN
    ALTER TABLE public.directory_plans
      ADD CONSTRAINT directory_plans_trial_period_unit_check
      CHECK (trial_period_unit IN ('none', 'days', 'weeks', 'months', 'years', 'forever'));
  END IF;
END $$;

COMMENT ON COLUMN public.directory_plans.trial_period_value IS
  'Trial duration for new signups, in units defined by trial_period_unit. 0 = no trial. Ignored when unit = "none" or "forever".';
COMMENT ON COLUMN public.directory_plans.trial_period_unit IS
  'One of: none, days, weeks, months, years, forever. "forever" creates a perpetual free trial that never auto-bills.';

-- ── Venue-level trial state (snapshot) ─────────────────────────────────────

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS directory_trial_started_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS directory_trial_ends_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS directory_trial_is_forever BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS directory_trial_plan_id UUID NULL,
  ADD COLUMN IF NOT EXISTS directory_trial_consumed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.venues.directory_trial_started_at IS
  'When the trial was granted. Used to display "trial started X days ago".';
COMMENT ON COLUMN public.venues.directory_trial_ends_at IS
  'When the trial ends and billing kicks in. NULL when no trial OR perpetual trial (see directory_trial_is_forever).';
COMMENT ON COLUMN public.venues.directory_trial_is_forever IS
  'TRUE when the venue is on a perpetual free trial that should never auto-bill.';
COMMENT ON COLUMN public.venues.directory_trial_plan_id IS
  'The plan that originally granted this trial. Stored separately from directory_plan_id so we can detect plan switches.';
COMMENT ON COLUMN public.venues.directory_trial_consumed IS
  'TRUE once a venue has used a trial (granted or expired). Prevents re-granting a trial when they switch plans.';

-- Soft FK — keeps the column nullable / SET NULL on plan delete to avoid
-- cascading damage if an admin removes a plan.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venues_directory_trial_plan_id_fkey'
  ) THEN
    ALTER TABLE public.venues
      ADD CONSTRAINT venues_directory_trial_plan_id_fkey
      FOREIGN KEY (directory_trial_plan_id)
      REFERENCES public.directory_plans(id)
      ON DELETE SET NULL;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
