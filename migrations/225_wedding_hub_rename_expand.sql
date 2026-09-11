-- ============================================================================
-- 225_wedding_hub_rename_expand.sql
--
-- "Bride Portal" is now "Wedding Hub". This is the EXPAND half of an
-- expand/contract rename so we can ship with zero downtime:
--
--   * add wedding_hub / wedding_hub_visibility columns
--   * backfill them from the old bride_portal / bride_portal_visibility columns
--   * keep the old columns for now (old code still reads them until deploy)
--
-- The CONTRACT half (226) drops the old columns after the new code is live.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS wedding_hub BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS wedding_hub_visibility JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill from the old columns (only where the old columns still exist).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'venues' AND column_name = 'bride_portal'
  ) THEN
    EXECUTE 'UPDATE public.venues SET wedding_hub = COALESCE(bride_portal, FALSE)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'venues' AND column_name = 'bride_portal_visibility'
  ) THEN
    EXECUTE 'UPDATE public.venues SET wedding_hub_visibility = COALESCE(bride_portal_visibility, ''{}''::jsonb)';
  END IF;
END $$;

COMMENT ON COLUMN public.venues.wedding_hub IS
  'Off-plan override for the Wedding Hub (formerly bride_portal). Legacy + All-Inclusive plans get the Hub automatically; for $97/Free plans this flag (default FALSE) unlocks it. Single source of truth for granting off-plan.';
COMMENT ON COLUMN public.venues.wedding_hub_visibility IS
  'Venue-controlled visibility map for what a connected couple can see (formerly bride_portal_visibility).';

NOTIFY pgrst, 'reload schema';

COMMIT;
