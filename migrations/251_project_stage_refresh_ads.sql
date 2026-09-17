-- Migration 251: add a "Refresh Ads" project board stage between Ads Ready and
-- Live (for existing live clients whose campaigns need a refresh). The Projects
-- board is data-driven from admin_project_stages, so inserting the row is all
-- that's needed — no code change.
--
-- Positions shift: Ads Ready(5) · Refresh Ads(6) · Live(7). Cards reference
-- stage UUIDs (venues.project_stage_id), never positions, so existing
-- placements are preserved. Idempotent: only makes room + inserts when the
-- stage doesn't already exist, so re-running never double-shifts.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_project_stages WHERE key = 'refresh_ads') THEN
    UPDATE public.admin_project_stages SET position = position + 1 WHERE position >= 6;
    INSERT INTO public.admin_project_stages (key, label, color, position)
    VALUES ('refresh_ads', 'Refresh Ads', '#f97316', 6);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
