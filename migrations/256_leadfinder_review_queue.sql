-- Migration 256: LeadFinder™ review queue state.
--
-- Why: until now every message that reached an email address and looked like an
-- inquiry became a lead and immediately fired the full follow-up, including the
-- pricing guide to the couple. An unfamiliar marketplace format could be
-- extracted down to nothing but the sender's address and still be treated as a
-- real, complete inquiry. Nothing read the confidence we already recorded, so
-- nobody would have noticed.
--
-- The confirm-first flow needs somewhere to record "a human still has to look at
-- this". That state belongs on the arrival row, which already carries the raw
-- email and the confidence scores — the review UI reads the original message
-- from `raw_text` right next to the extracted fields, so no extra table and no
-- copy of the data is needed.
--
-- Safety: purely additive. Every new column either has a constant DEFAULT (so
-- every row already imported keeps exactly today's behaviour — 'none' means "no
-- review needed") or is nullable. ADD COLUMN with a constant default is instant
-- on Postgres 11+ (no table rewrite). Nothing is renamed, dropped or repurposed.
-- Idempotent, so re-running is a no-op.
--
-- DIRECTION OF SAFETY — read this before changing the default:
--   'none' = no review needed. This is the DEFAULT and the old behaviour.
-- Only the LeadFinder ingest path writes 'needs_review', and only when the
-- extraction confidence is below the routing threshold.

ALTER TABLE public.leadfinder_imports
  ADD COLUMN IF NOT EXISTS review_state     text        NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS review_reason    text,
  ADD COLUMN IF NOT EXISTS field_confidence jsonb,
  ADD COLUMN IF NOT EXISTS reviewed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by      uuid;

-- Allowed values are enforced rather than trusted, so a typo in application code
-- cannot invent a state the queue does not understand.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'leadfinder_imports_review_state_check'
       AND conrelid = 'public.leadfinder_imports'::regclass
  ) THEN
    ALTER TABLE public.leadfinder_imports
      ADD CONSTRAINT leadfinder_imports_review_state_check
      CHECK (review_state IN ('none', 'needs_review', 'confirmed', 'dismissed'));
  END IF;
END $$;

COMMENT ON COLUMN public.leadfinder_imports.review_state IS
  'Human review state of a LeadFinder arrival. none = no review needed (default, old behaviour); needs_review = lead created and owner notified but the couple was NOT auto-contacted; confirmed = a human verified it and the guide may be sent; dismissed = a human rejected it.';

COMMENT ON COLUMN public.leadfinder_imports.review_reason IS
  'Short machine-ish reason the row entered the queue, e.g. low_confidence | ai_fallback_uncertain.';

COMMENT ON COLUMN public.leadfinder_imports.field_confidence IS
  'Per-field extraction confidence (0..1) keyed by field name, for the review UI. Nullable/tolerant: older rows have none.';

COMMENT ON COLUMN public.leadfinder_imports.reviewed_at IS
  'When a human last confirmed or dismissed this arrival.';

COMMENT ON COLUMN public.leadfinder_imports.reviewed_by IS
  'Team member who confirmed or dismissed this arrival, when known.';

-- The only query shape the queue needs: "this venue's rows still awaiting
-- review, newest first". Partial, because it is expected to stay tiny.
CREATE INDEX IF NOT EXISTS leadfinder_imports_review_queue_idx
  ON public.leadfinder_imports (venue_id, created_at DESC)
  WHERE review_state = 'needs_review';

-- Tell PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
