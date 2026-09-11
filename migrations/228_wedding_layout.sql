-- ============================================================================
-- 228_wedding_layout.sql
--
-- Wedding "Room layout" canvas — a separate, visual floor-plan document that
-- both the bride and the venue can edit. It is intentionally DECOUPLED from the
-- seating DATA (wedding_tables / wedding_guests.table_id): the canvas only
-- references a table by id to show its number + live headcount.
--
-- Stored as one JSONB document on couple_weddings so both sides (who already
-- read/write that row) share it. Purely additive — existing seating data is
-- untouched, so no current couple/venue is disrupted and nothing is lost.
--
-- Shape: { "rev": <int>, "elements": [ { id, kind, shape?, x, y, w, h,
--          rotation, tableId?, text? } ] }
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.couple_weddings
  ADD COLUMN IF NOT EXISTS layout JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';

COMMIT;
