-- Add enrolled_at column to marketing_automation_enrollments.
--
-- The table was originally created with started_at but the app code
-- (e.g. /api/leads/[id]/enrollments) selects and orders by enrolled_at.
-- This column records when the lead was first enrolled in the automation;
-- for existing rows we back-fill with started_at.
--
-- Idempotent — safe to re-run.

ALTER TABLE public.marketing_automation_enrollments
  ADD COLUMN IF NOT EXISTS enrolled_at timestamptz NOT NULL DEFAULT now();

-- Back-fill existing rows so the column is meaningful for historical data.
UPDATE public.marketing_automation_enrollments
  SET enrolled_at = started_at
  WHERE enrolled_at = now() AND started_at < now();

COMMENT ON COLUMN public.marketing_automation_enrollments.enrolled_at IS
  'Timestamp when this lead was first enrolled in the automation.';

NOTIFY pgrst, 'reload schema';
