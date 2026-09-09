-- Migration 216: Event Temple pipeline/stage routing per venue
-- Adds two nullable columns to venues so a venue can choose which Event Temple
-- pipeline (via a stage inside it) new lead bookings are created in:
--   eventtemple_pipeline_id — the selected Event Temple pipeline id (for display/filtering)
--   eventtemple_stage_id    — the selected Event Temple stage id; sent as stage_id on
--                             each created booking. A stage belongs to a pipeline, so
--                             setting the stage is how the booking lands in that pipeline.
-- Both are nullable; NULL means "use Event Temple's default stage/pipeline".

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS eventtemple_pipeline_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS eventtemple_stage_id    TEXT DEFAULT NULL;
