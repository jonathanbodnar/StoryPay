-- Append-only revision history for marketing form definitions (undo in UI uses client history; this is for audit / restore).
CREATE TABLE IF NOT EXISTS public.marketing_form_revisions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id         uuid        NOT NULL REFERENCES public.marketing_forms(id) ON DELETE CASCADE,
  venue_id        uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  definition_json jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_form_revisions_form_id_idx
  ON public.marketing_form_revisions (form_id, created_at DESC);

ALTER TABLE public.marketing_form_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read marketing_form_revisions" ON public.marketing_form_revisions;
DROP POLICY IF EXISTS "Owners write marketing_form_revisions" ON public.marketing_form_revisions;

CREATE POLICY "Owners read marketing_form_revisions" ON public.marketing_form_revisions
  FOR SELECT USING (
    venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
  );

CREATE POLICY "Owners write marketing_form_revisions" ON public.marketing_form_revisions
  FOR INSERT WITH CHECK (
    venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
