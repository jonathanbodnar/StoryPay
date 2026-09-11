-- ============================================================================
-- 235_couple_site_embed_mode.sql
--
-- The embed area now has two distinct, couple-controlled purposes:
--
--   embed_mode = 'page'  → a normal website/HTML embed shown in a page section
--                          (the existing behavior). Never touches the cover.
--   embed_mode = 'live'  → a LIVE VIDEO that is hidden before the event and
--                          automatically takes over the cover photo during the
--                          event window, then reverts to the cover afterward
--                          (or if it fails to load). Never shown as a section.
--
-- Additive + tolerant: existing rows default to 'page', preserving today's
-- behavior exactly. `embed_enabled` remains the master on/off; the app-layer
-- sanitizer clamps embed_mode to the two known values.
-- ============================================================================

BEGIN;

ALTER TABLE public.couple_sites
  ADD COLUMN IF NOT EXISTS embed_mode TEXT NOT NULL DEFAULT 'page';

NOTIFY pgrst, 'reload schema';

COMMIT;
