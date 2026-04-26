-- 067_workflow_execution_logs.sql
-- Per-step execution audit log for marketing automation workflows.
-- Records every step execution (success or failure) for diagnosis and
-- delivery tracking.  Linked to both the automation and the enrollment.

CREATE TABLE IF NOT EXISTS public.marketing_automation_execution_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid        NOT NULL REFERENCES public.marketing_automations(id) ON DELETE CASCADE,
  enrollment_id uuid        REFERENCES public.marketing_automation_enrollments(id) ON DELETE SET NULL,
  venue_id      uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  lead_id       uuid        REFERENCES public.leads(id) ON DELETE SET NULL,
  step_order    integer,
  step_type     text,
  status        text        NOT NULL DEFAULT 'success',
  error_text    text,
  executed_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_automation_execution_logs_status_chk
    CHECK (status IN ('success', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS mael_automation_id_idx
  ON public.marketing_automation_execution_logs (automation_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS mael_enrollment_id_idx
  ON public.marketing_automation_execution_logs (enrollment_id);
CREATE INDEX IF NOT EXISTS mael_venue_id_idx
  ON public.marketing_automation_execution_logs (venue_id);

ALTER TABLE public.marketing_automation_execution_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read marketing_automation_execution_logs" ON public.marketing_automation_execution_logs;
DROP POLICY IF EXISTS "Owners write marketing_automation_execution_logs" ON public.marketing_automation_execution_logs;

CREATE POLICY "Owners read marketing_automation_execution_logs"
  ON public.marketing_automation_execution_logs FOR SELECT USING (
    venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
  );

CREATE POLICY "Owners write marketing_automation_execution_logs"
  ON public.marketing_automation_execution_logs FOR ALL
  USING  (venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid()))
  WITH CHECK (venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid()));

NOTIFY pgrst, 'reload schema';
