-- 172_reengagement_drip.sql
--
-- Re-engagement drip for venues that completed their listing (sent a test
-- lead) but never added a CC. The drip runs for 90 days and stops the moment
-- the venue logs in and converts.
--
-- Also adds system_email_templates for super-admin editable system emails
-- (re-engagement copy, lead alert copy, etc.).

-- ── Reengagement drip tracking ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.venue_reengagement_drip (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  started_at      timestamptz NOT NULL DEFAULT now(),
  last_sent_at    timestamptz,
  -- When the next send should fire (NULL = first send not yet scheduled)
  next_send_at    timestamptz,
  emails_sent     integer     NOT NULL DEFAULT 0,
  -- active | paused | completed | converted | canceled
  status          text        NOT NULL DEFAULT 'active',
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_reengagement_drip_status_chk
    CHECK (status IN ('active', 'paused', 'completed', 'converted', 'canceled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_venue_reengagement_drip_venue
  ON public.venue_reengagement_drip (venue_id);

CREATE INDEX IF NOT EXISTS idx_venue_reengagement_drip_next
  ON public.venue_reengagement_drip (next_send_at)
  WHERE status = 'active';

ALTER TABLE public.venue_reengagement_drip ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_direct_access" ON public.venue_reengagement_drip;
CREATE POLICY "deny_direct_access" ON public.venue_reengagement_drip
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- ── System email templates (super-admin editable) ────────────────────────────

CREATE TABLE IF NOT EXISTS public.system_email_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text        NOT NULL UNIQUE,
  subject     text        NOT NULL,
  heading     text        NOT NULL,
  body        text        NOT NULL,
  button_text text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text        -- admin email for audit
);

CREATE INDEX IF NOT EXISTS idx_system_email_templates_key
  ON public.system_email_templates (key);

ALTER TABLE public.system_email_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_direct_access" ON public.system_email_templates;
CREATE POLICY "deny_direct_access" ON public.system_email_templates
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

NOTIFY pgrst, 'reload schema';
