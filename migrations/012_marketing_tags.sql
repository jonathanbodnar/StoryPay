-- =============================================================================
-- 012_marketing_tags.sql
--
-- Venue-scoped tags (name + display icon) for leads. Junction table assigns
-- many tags per lead for tracking and future automations.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketing_tags (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  icon        text        NOT NULL DEFAULT '🏷️',
  color       text,
  position    integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_tags_icon_len CHECK (char_length(icon) <= 16)
);

CREATE INDEX IF NOT EXISTS marketing_tags_venue_id_idx ON public.marketing_tags (venue_id);
CREATE INDEX IF NOT EXISTS marketing_tags_venue_position_idx ON public.marketing_tags (venue_id, position);

DROP TRIGGER IF EXISTS trg_marketing_tags_updated_at ON public.marketing_tags;
CREATE TRIGGER trg_marketing_tags_updated_at
  BEFORE UPDATE ON public.marketing_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.lead_tag_assignments (
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tag_id  uuid NOT NULL REFERENCES public.marketing_tags(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, tag_id)
);

CREATE INDEX IF NOT EXISTS lead_tag_assignments_lead_id_idx ON public.lead_tag_assignments (lead_id);
CREATE INDEX IF NOT EXISTS lead_tag_assignments_venue_id_idx ON public.lead_tag_assignments (venue_id);
CREATE INDEX IF NOT EXISTS lead_tag_assignments_tag_id_idx ON public.lead_tag_assignments (tag_id);

ALTER TABLE public.marketing_tags        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_tag_assignments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketing_tags', 'lead_tag_assignments']
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
