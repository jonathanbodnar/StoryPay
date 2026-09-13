-- ============================================================================
-- 241_wedding_planner_rename_expand.sql
--
-- "Wedding Hub" is now "Wedding Planner". This is the EXPAND half of an
-- expand/contract rename so we can ship with zero downtime:
--
--   * add wedding_planner / wedding_planner_visibility columns
--   * backfill them from the old wedding_hub / wedding_hub_visibility columns
--   * keep the old columns for now (old code still reads them until deploy)
--
-- The CONTRACT half (242) drops the old columns after the new code is live.
--
-- Also defensively renames any persisted system_email_templates rows whose
-- key was stored under the old wedding_hub_* keys to the new wedding_planner_*
-- keys, so no saved override copy is orphaned.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS wedding_planner BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS wedding_planner_visibility JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill from the old columns (only where the old columns still exist).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'venues' AND column_name = 'wedding_hub'
  ) THEN
    EXECUTE 'UPDATE public.venues SET wedding_planner = COALESCE(wedding_hub, FALSE)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'venues' AND column_name = 'wedding_hub_visibility'
  ) THEN
    EXECUTE 'UPDATE public.venues SET wedding_planner_visibility = COALESCE(wedding_hub_visibility, ''{}''::jsonb)';
  END IF;
END $$;

COMMENT ON COLUMN public.venues.wedding_planner IS
  'Off-plan override for the Wedding Planner (formerly wedding_hub / bride_portal). Legacy + All-Inclusive plans get it automatically; for $97/Free plans this flag (default FALSE) unlocks it. Single source of truth for granting off-plan.';
COMMENT ON COLUMN public.venues.wedding_planner_visibility IS
  'Venue-controlled visibility map for what a connected couple can see (formerly wedding_hub_visibility / bride_portal_visibility).';

-- Migrate any saved system email template overrides to the new keys.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'system_email_templates' AND column_name = 'key'
  ) THEN
    EXECUTE 'UPDATE public.system_email_templates SET key = ''wedding_planner_invite'' WHERE key = ''wedding_hub_invite'' AND NOT EXISTS (SELECT 1 FROM public.system_email_templates t2 WHERE t2.key = ''wedding_planner_invite'')';
    EXECUTE 'UPDATE public.system_email_templates SET key = ''wedding_planner_connected'' WHERE key = ''wedding_hub_connected'' AND NOT EXISTS (SELECT 1 FROM public.system_email_templates t2 WHERE t2.key = ''wedding_planner_connected'')';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
