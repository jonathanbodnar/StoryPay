-- 171_sms_reply_tracking.sql
--
-- Reply attribution for automated SMS sequences (Speed to Lead / Booking
-- System). SMS has no "open rate" — there is no pixel or delivery receipt we
-- can act on. The actionable signal is which SMS step a bride replies to.
--
-- When a bride sends an inbound SMS, we credit the last automated SMS step
-- that was sent to her (from marketing_automation_execution_logs) with a
-- "reply". One first-reply credit per enrollment. Aggregated across all
-- venues this tells us which message in the standard sequence actually
-- earns responses, so we can tune the master copy over time.

CREATE TABLE IF NOT EXISTS public.marketing_sms_reply_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  automation_id   uuid        REFERENCES public.marketing_automations(id) ON DELETE SET NULL,
  -- Snapshot of the automation name (e.g. "Speed to Lead — Booking System")
  -- so cross-venue rollups survive automation deletion / renames.
  automation_name text,
  enrollment_id   uuid        REFERENCES public.marketing_automation_enrollments(id) ON DELETE SET NULL,
  lead_id         uuid        REFERENCES public.leads(id) ON DELETE SET NULL,
  -- The SMS step credited (0-based step_order of the last send_sms before reply).
  step_order      integer     NOT NULL,
  -- Snapshot of the SMS body that was live when it was sent.
  step_body       text,
  -- True when the venue customized the body vs. the shipped default template.
  is_custom_body  boolean     NOT NULL DEFAULT false,
  sent_at         timestamptz,
  replied_at      timestamptz NOT NULL DEFAULT now(),
  hours_to_reply  numeric,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One first-reply credit per enrollment (guards double-counting subsequent
-- replies in the same conversation).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_reply_enrollment
  ON public.marketing_sms_reply_events (enrollment_id)
  WHERE enrollment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sms_reply_venue
  ON public.marketing_sms_reply_events (venue_id);
CREATE INDEX IF NOT EXISTS idx_sms_reply_automation_name
  ON public.marketing_sms_reply_events (automation_name, replied_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_reply_replied_at
  ON public.marketing_sms_reply_events (replied_at DESC);

-- Backend-only table: all access goes through the Next.js server using the
-- service_role key (which bypasses RLS). Enable RLS + explicit deny for the
-- public browser roles to satisfy Supabase's security advisor.
ALTER TABLE public.marketing_sms_reply_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_direct_access" ON public.marketing_sms_reply_events;
CREATE POLICY "deny_direct_access" ON public.marketing_sms_reply_events
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

NOTIFY pgrst, 'reload schema';
