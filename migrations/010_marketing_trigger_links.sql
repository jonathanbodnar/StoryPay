-- =============================================================================
-- 010_marketing_trigger_links.sql
--
-- Trigger links: stable short codes that redirect to an editable target URL,
-- with click logging. Lead marketing events capture trigger clicks and
-- optional page views for activity timelines.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.trigger_links (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  target_url   text        NOT NULL,
  short_code   text        NOT NULL,
  click_count  bigint      NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trigger_links_short_code_len CHECK (
    char_length(short_code) >= 8 AND char_length(short_code) <= 40
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS trigger_links_short_code_uidx ON public.trigger_links (short_code);
CREATE INDEX IF NOT EXISTS trigger_links_venue_id_idx ON public.trigger_links (venue_id);

DROP TRIGGER IF EXISTS trg_trigger_links_updated_at ON public.trigger_links;
CREATE TRIGGER trg_trigger_links_updated_at
  BEFORE UPDATE ON public.trigger_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Prevent changing short_code after insert (destination URL may change freely).
CREATE OR REPLACE FUNCTION public.trigger_links_short_code_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.short_code IS DISTINCT FROM OLD.short_code THEN
    RAISE EXCEPTION 'short_code cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trigger_links_short_code_immutable ON public.trigger_links;
CREATE TRIGGER trg_trigger_links_short_code_immutable
  BEFORE UPDATE ON public.trigger_links
  FOR EACH ROW EXECUTE FUNCTION public.trigger_links_short_code_immutable();

CREATE TABLE IF NOT EXISTS public.lead_marketing_events (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id         uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  lead_id          uuid        REFERENCES public.leads(id) ON DELETE CASCADE,
  event_type       text        NOT NULL
                     CHECK (event_type IN ('trigger_link_click', 'page_view')),
  trigger_link_id  uuid        REFERENCES public.trigger_links(id) ON DELETE SET NULL,
  page_path        text,
  page_title       text,
  referrer         text,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_marketing_events_lead_created_idx
  ON public.lead_marketing_events (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lead_marketing_events_venue_created_idx
  ON public.lead_marketing_events (venue_id, created_at DESC);

ALTER TABLE public.trigger_links        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_marketing_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['trigger_links', 'lead_marketing_events']
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
