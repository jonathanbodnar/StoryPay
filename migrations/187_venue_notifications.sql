-- Stores per-venue notification preferences (email, SMS, push toggles).
-- The settings column is a jsonb blob merged with DEFAULT_NOTIFICATIONS at
-- read time so new keys can be added without a schema change.

CREATE TABLE IF NOT EXISTS public.venue_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid NOT NULL UNIQUE REFERENCES public.venues(id) ON DELETE CASCADE,
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_notifications_venue_id_idx
  ON public.venue_notifications (venue_id);

ALTER TABLE public.venue_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_notifications FROM anon, authenticated;
GRANT ALL ON public.venue_notifications TO service_role;
