-- =============================================================================
-- 014_marketing_email.sql
--
-- Native marketing email: Flodesk-style templates (JSON blocks), campaigns
-- with segments + schedule/send, automations (tag / stage / trigger link),
-- suppressions, recipient queue.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketing_email_templates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  subject         text        NOT NULL DEFAULT '',
  preheader       text        NOT NULL DEFAULT '',
  definition_json jsonb       NOT NULL DEFAULT '{"version":1,"blocks":[],"theme":{}}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_email_templates_name_len CHECK (char_length(name) >= 1 AND char_length(name) <= 200)
);

CREATE INDEX IF NOT EXISTS marketing_email_templates_venue_id_idx ON public.marketing_email_templates (venue_id);

DROP TRIGGER IF EXISTS trg_marketing_email_templates_updated_at ON public.marketing_email_templates;
CREATE TRIGGER trg_marketing_email_templates_updated_at
  BEFORE UPDATE ON public.marketing_email_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  template_id     uuid        NOT NULL REFERENCES public.marketing_email_templates(id) ON DELETE RESTRICT,
  name            text        NOT NULL,
  segment_json    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status          text        NOT NULL DEFAULT 'draft',
  scheduled_at    timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_campaigns_status_chk CHECK (
    status IN ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled')
  ),
  CONSTRAINT marketing_campaigns_name_len CHECK (char_length(name) >= 1 AND char_length(name) <= 200)
);

CREATE INDEX IF NOT EXISTS marketing_campaigns_venue_id_idx ON public.marketing_campaigns (venue_id);
CREATE INDEX IF NOT EXISTS marketing_campaigns_status_scheduled_idx ON public.marketing_campaigns (venue_id, status, scheduled_at);

DROP TRIGGER IF EXISTS trg_marketing_campaigns_updated_at ON public.marketing_campaigns;
CREATE TRIGGER trg_marketing_campaigns_updated_at
  BEFORE UPDATE ON public.marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.marketing_campaign_recipients (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid        NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  venue_id     uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  lead_id      uuid        NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  email        text        NOT NULL,
  status       text        NOT NULL DEFAULT 'queued',
  sent_at      timestamptz,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_campaign_recipients_status_chk CHECK (
    status IN ('queued', 'sent', 'failed', 'skipped_unsub', 'skipped_no_email')
  ),
  CONSTRAINT marketing_campaign_recipients_campaign_lead_uidx UNIQUE (campaign_id, lead_id)
);

CREATE INDEX IF NOT EXISTS marketing_campaign_recipients_campaign_status_idx ON public.marketing_campaign_recipients (campaign_id, status);
CREATE INDEX IF NOT EXISTS marketing_campaign_recipients_venue_id_idx ON public.marketing_campaign_recipients (venue_id);

CREATE TABLE IF NOT EXISTS public.marketing_email_suppressions (
  lead_id    uuid        NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  venue_id   uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  reason     text        NOT NULL DEFAULT 'unsubscribe',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, venue_id)
);

CREATE INDEX IF NOT EXISTS marketing_email_suppressions_venue_id_idx ON public.marketing_email_suppressions (venue_id);

CREATE TABLE IF NOT EXISTS public.marketing_automations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  status          text        NOT NULL DEFAULT 'draft',
  trigger_type    text        NOT NULL,
  trigger_config  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_automations_status_chk CHECK (status IN ('draft', 'active', 'paused')),
  CONSTRAINT marketing_automations_trigger_chk CHECK (
    trigger_type IN ('tag_added', 'stage_changed', 'trigger_link_click')
  ),
  CONSTRAINT marketing_automations_name_len CHECK (char_length(name) >= 1 AND char_length(name) <= 200)
);

CREATE INDEX IF NOT EXISTS marketing_automations_venue_id_idx ON public.marketing_automations (venue_id);
CREATE INDEX IF NOT EXISTS marketing_automations_venue_status_idx ON public.marketing_automations (venue_id, status);

DROP TRIGGER IF EXISTS trg_marketing_automations_updated_at ON public.marketing_automations;
CREATE TRIGGER trg_marketing_automations_updated_at
  BEFORE UPDATE ON public.marketing_automations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.marketing_automation_steps (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id  uuid        NOT NULL REFERENCES public.marketing_automations(id) ON DELETE CASCADE,
  step_order     integer     NOT NULL,
  step_type      text        NOT NULL,
  config_json    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_automation_steps_type_chk CHECK (step_type IN ('delay', 'send_email')),
  CONSTRAINT marketing_automation_steps_order_uidx UNIQUE (automation_id, step_order)
);

CREATE INDEX IF NOT EXISTS marketing_automation_steps_automation_id_idx ON public.marketing_automation_steps (automation_id);

CREATE TABLE IF NOT EXISTS public.marketing_automation_enrollments (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id      uuid        NOT NULL REFERENCES public.marketing_automations(id) ON DELETE CASCADE,
  venue_id           uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  lead_id            uuid        NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  current_step_index integer     NOT NULL DEFAULT 0,
  status             text        NOT NULL DEFAULT 'active',
  next_run_at        timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  last_error         text,
  CONSTRAINT marketing_automation_enrollments_status_chk CHECK (
    status IN ('active', 'completed', 'cancelled', 'failed')
  ),
  CONSTRAINT marketing_automation_enrollments_automation_lead_uidx UNIQUE (automation_id, lead_id)
);

CREATE INDEX IF NOT EXISTS marketing_automation_enrollments_next_run_idx ON public.marketing_automation_enrollments (status, next_run_at);
CREATE INDEX IF NOT EXISTS marketing_automation_enrollments_venue_id_idx ON public.marketing_automation_enrollments (venue_id);

ALTER TABLE public.marketing_email_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaigns            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaign_recipients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_email_suppressions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_automations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_automation_steps     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_automation_enrollments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'marketing_email_templates',
    'marketing_campaigns',
    'marketing_campaign_recipients',
    'marketing_email_suppressions',
    'marketing_automations',
    'marketing_automation_enrollments'
  ]
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

ALTER TABLE public.marketing_automation_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners read marketing_automation_steps" ON public.marketing_automation_steps;
DROP POLICY IF EXISTS "Owners write marketing_automation_steps" ON public.marketing_automation_steps;

CREATE POLICY "Owners read marketing_automation_steps" ON public.marketing_automation_steps
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.marketing_automations a
      WHERE a.id = marketing_automation_steps.automation_id
        AND a.venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "Owners write marketing_automation_steps" ON public.marketing_automation_steps
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.marketing_automations a
      WHERE a.id = marketing_automation_steps.automation_id
        AND a.venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.marketing_automations a
      WHERE a.id = marketing_automation_steps.automation_id
        AND a.venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';
