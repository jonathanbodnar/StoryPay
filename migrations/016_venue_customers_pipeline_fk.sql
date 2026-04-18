-- =============================================================================
-- 016_venue_customers_pipeline_fk.sql
-- Links venue_customers to lead pipelines so profile stages stay in sync with Leads.
--
-- REQUIRED on every Supabase project that runs this app: Dashboard → SQL →
-- paste this file → Run. Without these columns, /api/venue-customers PATCH fails.
-- =============================================================================

ALTER TABLE public.venue_customers
  ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES public.lead_pipelines(id) ON DELETE SET NULL;

ALTER TABLE public.venue_customers
  ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES public.lead_pipeline_stages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS venue_customers_pipeline_stage_idx
  ON public.venue_customers (venue_id, pipeline_id, stage_id);

COMMENT ON COLUMN public.venue_customers.pipeline_id IS 'Selected sales pipeline (defaults to venue default; mirrored with matching lead)';
COMMENT ON COLUMN public.venue_customers.stage_id IS 'Current stage in pipeline_id; kept in sync with leads row when emails match';

NOTIFY pgrst, 'reload schema';
