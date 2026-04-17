-- =============================================================================
-- 008_lead_pipelines.sql
--
-- Kanban-style sales pipeline for the Leads page.
--
--   * `lead_pipelines`        — a venue can have multiple pipelines (e.g. one
--                               per brand or per sales process)
--   * `lead_pipeline_stages`  — ordered stages inside a pipeline
--                               (user-editable: rename, add, remove, reorder)
--   * `lead_notes`            — timestamped notes attached to a lead
--
-- The `leads` table picks up new fields: first/last name split, venue_name,
-- venue_website_url, opportunity_value, pipeline_id, stage_id and a `position`
-- used for ordering cards inside a Kanban column.
--
-- The existing `status` column is kept for backwards compatibility. The API
-- keeps it in sync with stage_id where possible (the default template uses
-- the same concepts).
-- =============================================================================

-- ── leads: new columns ──────────────────────────────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS first_name         text,
  ADD COLUMN IF NOT EXISTS last_name          text,
  ADD COLUMN IF NOT EXISTS venue_name         text,
  ADD COLUMN IF NOT EXISTS venue_website_url  text,
  ADD COLUMN IF NOT EXISTS opportunity_value  numeric(12, 2),
  ADD COLUMN IF NOT EXISTS pipeline_id        uuid,
  ADD COLUMN IF NOT EXISTS stage_id           uuid,
  ADD COLUMN IF NOT EXISTS position           integer NOT NULL DEFAULT 0;

-- Best-effort backfill of first/last from the existing `name` column so new UI
-- has something to show immediately.
UPDATE public.leads
   SET first_name = split_part(trim(name), ' ', 1),
       last_name  = NULLIF(trim(substring(trim(name) FROM position(' ' in trim(name)) + 1)), '')
 WHERE first_name IS NULL AND name IS NOT NULL;

-- ── lead_pipelines ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_pipelines (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  is_default  boolean     NOT NULL DEFAULT false,
  position    integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_pipelines_venue_id_idx ON public.lead_pipelines (venue_id);
CREATE UNIQUE INDEX IF NOT EXISTS lead_pipelines_one_default_per_venue
  ON public.lead_pipelines (venue_id) WHERE is_default;

DROP TRIGGER IF EXISTS trg_lead_pipelines_updated_at ON public.lead_pipelines;
CREATE TRIGGER trg_lead_pipelines_updated_at
  BEFORE UPDATE ON public.lead_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── lead_pipeline_stages ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_pipeline_stages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid        NOT NULL REFERENCES public.lead_pipelines(id) ON DELETE CASCADE,
  venue_id    uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  color       text        NOT NULL DEFAULT '#6b7280',
  -- 'open' = active, 'won' = booked, 'lost' = dead (used for stats)
  kind        text        NOT NULL DEFAULT 'open'
                          CHECK (kind IN ('open', 'won', 'lost')),
  position    integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_pipeline_stages_pipeline_id_idx ON public.lead_pipeline_stages (pipeline_id);
CREATE INDEX IF NOT EXISTS lead_pipeline_stages_venue_id_idx    ON public.lead_pipeline_stages (venue_id);

DROP TRIGGER IF EXISTS trg_lead_pipeline_stages_updated_at ON public.lead_pipeline_stages;
CREATE TRIGGER trg_lead_pipeline_stages_updated_at
  BEFORE UPDATE ON public.lead_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Now that the stages table exists, wire up the FKs on `leads`.
DO $$ BEGIN
  ALTER TABLE public.leads
    ADD CONSTRAINT leads_pipeline_id_fk
      FOREIGN KEY (pipeline_id) REFERENCES public.lead_pipelines(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.leads
    ADD CONSTRAINT leads_stage_id_fk
      FOREIGN KEY (stage_id) REFERENCES public.lead_pipeline_stages(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS leads_pipeline_id_idx ON public.leads (pipeline_id);
CREATE INDEX IF NOT EXISTS leads_stage_id_idx    ON public.leads (stage_id);

-- ── lead_notes ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_notes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  lead_id     uuid        NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  content     text        NOT NULL,
  author_name text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_notes_lead_id_idx    ON public.lead_notes (lead_id);
CREATE INDEX IF NOT EXISTS lead_notes_venue_id_idx   ON public.lead_notes (venue_id);
CREATE INDEX IF NOT EXISTS lead_notes_created_at_idx ON public.lead_notes (created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Server always uses service_role so these matter only if an anon key ever
-- reaches these tables. We keep the same pattern as the rest of the project:
-- enable RLS, let owners read/write their own rows.
ALTER TABLE public.lead_pipelines        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_pipeline_stages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_notes            ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lead_pipelines', 'lead_pipeline_stages', 'lead_notes']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Owners read %1$I" ON public.%1$I;',  t);
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
