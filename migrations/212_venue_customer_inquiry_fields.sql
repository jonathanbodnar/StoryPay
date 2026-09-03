-- ============================================================================
-- 212_venue_customer_inquiry_fields.sql
--
-- The public listing lead form (weddingdirectory) collects two qualifying
-- questions that until now only lived on the immutable `leads` row:
--   • booking_timeline  — "When do you plan to start touring?"
--   • venue_matters     — "What matters most when choosing a venue?"
--
-- The contact profile "Event Details" card reads/writes `venue_customers`, so
-- to surface (and let venues edit) these answers there we mirror both columns
-- onto venue_customers. /api/public/leads now upserts them here at intake for
-- brand-new leads; the backfill below populates every existing contact from
-- their most-recent matching lead so they show up immediately.
--
-- Idempotent — safe to re-run.
-- ============================================================================

ALTER TABLE public.venue_customers
  ADD COLUMN IF NOT EXISTS booking_timeline text,
  ADD COLUMN IF NOT EXISTS venue_matters    text;

-- Backfill existing contacts from the latest lead sharing their venue + email.
-- COALESCE keeps any value that somehow already exists on the contact row.
UPDATE public.venue_customers vc
SET
  booking_timeline = COALESCE(vc.booking_timeline, l.booking_timeline),
  venue_matters    = COALESCE(vc.venue_matters,    l.venue_matters)
FROM (
  SELECT DISTINCT ON (venue_id, lower(email))
    venue_id,
    lower(email) AS email_lc,
    booking_timeline,
    venue_matters
  FROM public.leads
  WHERE booking_timeline IS NOT NULL OR venue_matters IS NOT NULL
  ORDER BY venue_id, lower(email), created_at DESC
) l
WHERE l.venue_id = vc.venue_id
  AND l.email_lc = lower(vc.customer_email)
  AND (vc.booking_timeline IS NULL OR vc.venue_matters IS NULL);

NOTIFY pgrst, 'reload schema';
