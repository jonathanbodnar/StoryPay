-- Migration 209: make project-board membership explicit.
--
-- Board membership is now driven solely by venues.project_stage_id (a venue is
-- on the board iff it has a stage). This lets the operator add AND remove any
-- venue. Existing private clients are backfilled into the first stage so the
-- board looks unchanged after this migration.

UPDATE public.venues
SET project_stage_id = (SELECT id FROM public.admin_project_stages ORDER BY position ASC LIMIT 1)
WHERE is_private_client IS TRUE
  AND project_stage_id IS NULL;
