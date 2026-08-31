-- 210_ad_creatives_batch_id.sql
-- Group each ad generation into a "version" so the studio can cycle through
-- past sets. Every creative made in one POST shares a batch_id.

ALTER TABLE public.venue_ad_creatives
  ADD COLUMN IF NOT EXISTS batch_id uuid;

-- Backfill existing rows: treat each (venue_id, created_at::date) as one batch
-- so old generations still cluster sensibly.
UPDATE public.venue_ad_creatives
SET batch_id = gen_random_uuid()
WHERE batch_id IS NULL;

CREATE INDEX IF NOT EXISTS venue_ad_creatives_batch_idx
  ON public.venue_ad_creatives (venue_id, created_at DESC, batch_id);
