-- =============================================================================
-- 017_crm_intelligence.sql
-- CRM: lead assignment, stage win %, activity audit, team revenue visibility,
-- optional listing marketing spend for rough ROI.
-- =============================================================================

-- Lead owner (sales) — team member; venue owner is not in this table (null = unassigned / owner pool)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS assigned_member_id uuid REFERENCES public.venue_team_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS leads_assigned_member_idx ON public.leads (venue_id, assigned_member_id);

COMMENT ON COLUMN public.leads.assigned_member_id IS 'Team member responsible for this lead; NULL = unassigned';

-- Per-stage win probability for weighted pipeline (0–100). NULL = app uses defaults from kind (open/won/lost).
ALTER TABLE public.lead_pipeline_stages
  ADD COLUMN IF NOT EXISTS win_probability numeric(5, 2);

COMMENT ON COLUMN public.lead_pipeline_stages.win_probability IS '0–100; weighted pipeline = sum(opp * win_probability/100). NULL uses kind-based defaults.';

-- Team: hide revenue KPIs from this member (owner always sees revenue in app logic)
ALTER TABLE public.venue_team_members
  ADD COLUMN IF NOT EXISTS hide_revenue boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.venue_team_members.hide_revenue IS 'When true, dashboard/leads hide dollar amounts for this member';

-- Optional monthly listing/marketing budget for rough ROI vs directory-sourced revenue
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS listing_marketing_monthly_spend numeric(14, 2);

COMMENT ON COLUMN public.venues.listing_marketing_monthly_spend IS 'Optional monthly ad/listing spend for ROI hints (manual entry)';

-- Append-only audit trail for CRM actions on leads
CREATE TABLE IF NOT EXISTS public.lead_activity_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id         uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  lead_id          uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  actor_member_id  uuid REFERENCES public.venue_team_members(id) ON DELETE SET NULL,
  actor_is_owner   boolean NOT NULL DEFAULT false,
  action           text NOT NULL,
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_activity_log_action_len CHECK (char_length(action) >= 1 AND char_length(action) <= 64)
);

CREATE INDEX IF NOT EXISTS lead_activity_log_lead_idx ON public.lead_activity_log (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lead_activity_log_venue_idx ON public.lead_activity_log (venue_id, created_at DESC);

ALTER TABLE public.lead_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access lead_activity_log" ON public.lead_activity_log;
CREATE POLICY "Service role full access lead_activity_log" ON public.lead_activity_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON public.lead_activity_log TO service_role;

NOTIFY pgrst, 'reload schema';
