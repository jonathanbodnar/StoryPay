-- Migration 249: add a "Create Ads" project board stage between Training and
-- Ads Ready. The Projects board is fully data-driven from admin_project_stages
-- (see src/app/api/admin/projects/route.ts), so inserting the row is all that's
-- needed — no code change.
--
-- Positions shift: Training(3) · Create Ads(4) · Ads Ready(5) · Live(6).
-- Cards reference stage UUIDs (venues.project_stage_id), never positions, so
-- existing placements are preserved. Idempotent: only makes room + inserts when
-- the stage doesn't already exist, so re-running never double-shifts.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_project_stages WHERE key = 'create_ads') THEN
    UPDATE public.admin_project_stages SET position = position + 1 WHERE position >= 4;
    INSERT INTO public.admin_project_stages (key, label, color, position)
    VALUES ('create_ads', 'Create Ads', '#ec4899', 4);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
