-- =============================================================================
-- 015_venue_crm_upgrade.sql
--
-- Lost reason / referral / UTM on leads, lead tasks, venue booking goal,
-- campaign email open tracking, RLS on lead_tasks.
-- =============================================================================

-- Leads: attribution & loss tracking
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lost_reason text,
  ADD COLUMN IF NOT EXISTS referral_source text,
  ADD COLUMN IF NOT EXISTS first_touch_utm jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.leads.referral_source IS 'Free text: planner name, venue, partner, etc.';
COMMENT ON COLUMN public.leads.first_touch_utm IS 'First-touch UTM params: source, medium, campaign, term, content';

-- Venue goal for dashboard (revenue / bookings target — interpret as user preference)
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS monthly_booking_goal numeric(14, 2);

COMMENT ON COLUMN public.venues.monthly_booking_goal IS 'Optional monthly revenue or booking count goal for dashboard';

-- Campaign recipient opens (tracking pixel)
ALTER TABLE public.marketing_campaign_recipients
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS link_click_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS marketing_campaign_recipients_opened_idx
  ON public.marketing_campaign_recipients (venue_id, opened_at)
  WHERE opened_at IS NOT NULL;

-- Lead tasks (CRM)
CREATE TABLE IF NOT EXISTS public.lead_tasks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  lead_id      uuid        NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  title        text        NOT NULL,
  due_at       timestamptz,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_tasks_title_len CHECK (char_length(trim(title)) >= 1 AND char_length(title) <= 500)
);

CREATE INDEX IF NOT EXISTS lead_tasks_lead_id_idx ON public.lead_tasks (lead_id);
CREATE INDEX IF NOT EXISTS lead_tasks_venue_due_idx ON public.lead_tasks (venue_id, due_at);

ALTER TABLE public.lead_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read lead_tasks" ON public.lead_tasks;
DROP POLICY IF EXISTS "Owners write lead_tasks" ON public.lead_tasks;

CREATE POLICY "Owners read lead_tasks" ON public.lead_tasks
  FOR SELECT USING (
    venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
  );

CREATE POLICY "Owners write lead_tasks" ON public.lead_tasks
  FOR ALL USING (
    venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
  ) WITH CHECK (
    venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
