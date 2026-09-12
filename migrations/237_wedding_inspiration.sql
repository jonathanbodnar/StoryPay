-- ============================================================================
-- 237_wedding_inspiration.sql
--
-- Wedding "Inspiration board" — a shared style/mood board that BOTH the couple
-- and the venue can see and curate. Items are just references (image URLs +
-- click-through links) pulled from the bride's Pinterest, individual pins, or
-- pasted image/links — we never host the image bytes, only the URLs.
--
-- Stored as one JSONB document on couple_weddings so both sides (who already
-- read/write that row) share it, exactly like layout (228) and timeline (236).
--
-- Purely additive — existing data is untouched, old rows default to '{}' and are
-- read tolerantly by sanitizeInspiration(), so nothing is lost.
--
-- Shape: { "rev": <int>, "items": [ { id, type, imageUrl, linkUrl, title, note,
--          source } ] }
--   type   = 'pin' | 'image' | 'link'
--   source = 'pinterest' | 'manual'
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.couple_weddings
  ADD COLUMN IF NOT EXISTS inspiration JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';

COMMIT;
