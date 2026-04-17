-- =============================================================================
-- 013_marketing_forms.sql
--
-- Embeddable marketing forms: JSON definition (blocks + theme), stable
-- embed_token for public iframe URLs, submissions with JSON payload.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketing_forms (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id         uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name             text        NOT NULL,
  embed_token      text        NOT NULL DEFAULT (lower(replace(gen_random_uuid()::text, '-', ''))),
  definition_json  jsonb       NOT NULL DEFAULT '{"version":1,"blocks":[],"theme":{}}'::jsonb,
  published        boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_forms_embed_token_len CHECK (char_length(embed_token) = 32),
  CONSTRAINT marketing_forms_name_len CHECK (char_length(name) >= 1 AND char_length(name) <= 200)
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_forms_embed_token_uidx ON public.marketing_forms (embed_token);
CREATE INDEX IF NOT EXISTS marketing_forms_venue_id_idx ON public.marketing_forms (venue_id);

DROP TRIGGER IF EXISTS trg_marketing_forms_updated_at ON public.marketing_forms;
CREATE TRIGGER trg_marketing_forms_updated_at
  BEFORE UPDATE ON public.marketing_forms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.marketing_forms_embed_token_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.embed_token IS DISTINCT FROM OLD.embed_token THEN
    RAISE EXCEPTION 'embed_token cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marketing_forms_embed_token_immutable ON public.marketing_forms;
CREATE TRIGGER trg_marketing_forms_embed_token_immutable
  BEFORE UPDATE ON public.marketing_forms
  FOR EACH ROW EXECUTE FUNCTION public.marketing_forms_embed_token_immutable();

CREATE TABLE IF NOT EXISTS public.marketing_form_submissions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id     uuid        NOT NULL REFERENCES public.marketing_forms(id) ON DELETE CASCADE,
  venue_id    uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_form_submissions_form_id_idx ON public.marketing_form_submissions (form_id);
CREATE INDEX IF NOT EXISTS marketing_form_submissions_venue_id_idx ON public.marketing_form_submissions (venue_id);
CREATE INDEX IF NOT EXISTS marketing_form_submissions_created_at_idx ON public.marketing_form_submissions (created_at DESC);

-- venue_id is denormalized for RLS; the submit API sets it from marketing_forms.venue_id.

ALTER TABLE public.marketing_forms           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_form_submissions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketing_forms', 'marketing_form_submissions']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Owners read %1$I" ON public.%1$I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Owners write %1$I" ON public.%1$I;', t);

    EXECUTE format($f$
      CREATE POLICY "Owners read %1$I" ON public.%1$I
        FOR SELECT USING (
          venue_id IN (
            SELECT id FROM public.venues WHERE owner_id = auth.uid()
          )
        );
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY "Owners write %1$I" ON public.%1$I
        FOR ALL USING (
          venue_id IN (
            SELECT id FROM public.venues WHERE owner_id = auth.uid()
          )
        ) WITH CHECK (
          venue_id IN (
            SELECT id FROM public.venues WHERE owner_id = auth.uid()
          )
        );
    $f$, t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
