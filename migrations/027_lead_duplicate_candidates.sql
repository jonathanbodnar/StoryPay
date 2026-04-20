-- Possible duplicate leads (same email or phone within a venue). User can dismiss or merge.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lead_duplicate_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  matches_lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('same_email', 'same_phone', 'same_email_and_phone')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'merged')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT lead_dup_different CHECK (lead_id <> matches_lead_id)
);

CREATE INDEX IF NOT EXISTS lead_dup_candidates_venue_open_idx
  ON public.lead_duplicate_candidates (venue_id, status)
  WHERE status = 'open';

CREATE UNIQUE INDEX IF NOT EXISTS lead_dup_open_pair_uidx
  ON public.lead_duplicate_candidates (venue_id, LEAST(lead_id, matches_lead_id), GREATEST(lead_id, matches_lead_id))
  WHERE status = 'open';

ALTER TABLE public.lead_duplicate_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role lead_duplicate_candidates" ON public.lead_duplicate_candidates;
CREATE POLICY "Service role lead_duplicate_candidates" ON public.lead_duplicate_candidates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT ALL ON public.lead_duplicate_candidates TO service_role;

COMMENT ON TABLE public.lead_duplicate_candidates IS 'Open pairs are shown in CRM; merged/dismissed rows are historical';

COMMIT;
