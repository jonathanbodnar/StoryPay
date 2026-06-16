-- 142_error_logs.sql
-- Centralized platform-wide error / issue log.
--
-- Captures failures from every surface of the CRM (API routes, integrations
-- like SMS/email/payments, webhooks, cron jobs) across ALL sub-accounts
-- (venues). Powers the super-admin "Error Log" tab for troubleshooting.
--
-- Access model: writes + reads happen exclusively via the service-role client
-- (supabaseAdmin) and admin API routes. RLS is ENABLED with no policies so the
-- anon role can never read platform-wide error data (service role bypasses RLS).

CREATE TABLE IF NOT EXISTS public.error_logs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  -- Severity: info | warning | error | critical
  level            text        NOT NULL DEFAULT 'error',
  -- Origin surface: api | client | sms | email | payment | webhook | ai | cron | other
  source           text        NOT NULL DEFAULT 'api',
  -- Finer bucket, e.g. ghl_sms_send, lunarpay_charge, inbound_email, button_action
  category         text,
  message          text        NOT NULL,
  stack            text,
  -- Sub-account this error belongs to (nullable for platform-level errors)
  venue_id         uuid        REFERENCES public.venues(id) ON DELETE SET NULL,
  -- Who hit it, when known (email kept rather than FK so it survives deletes)
  user_email       text,
  -- Page path or API endpoint involved
  route            text,
  method           text,
  http_status      integer,
  -- Redacted structured context: request payload, browser/device, feature, etc.
  context          jsonb,
  -- Stable hash of source+category+normalized-message+route for grouping dupes
  fingerprint      text,
  occurrence_count integer     NOT NULL DEFAULT 1,
  -- Triage workflow: new | investigating | resolved | ignored
  status           text        NOT NULL DEFAULT 'new',
  resolved_by      text,
  resolved_at      timestamptz,
  notes            text,
  CONSTRAINT error_logs_level_chk
    CHECK (level IN ('info', 'warning', 'error', 'critical')),
  CONSTRAINT error_logs_status_chk
    CHECK (status IN ('new', 'investigating', 'resolved', 'ignored'))
);

CREATE INDEX IF NOT EXISTS error_logs_created_at_idx   ON public.error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS error_logs_last_seen_idx    ON public.error_logs (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS error_logs_venue_id_idx     ON public.error_logs (venue_id);
CREATE INDEX IF NOT EXISTS error_logs_level_idx        ON public.error_logs (level);
CREATE INDEX IF NOT EXISTS error_logs_source_idx       ON public.error_logs (source);
CREATE INDEX IF NOT EXISTS error_logs_status_idx       ON public.error_logs (status);
CREATE INDEX IF NOT EXISTS error_logs_fingerprint_idx  ON public.error_logs (fingerprint);

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
-- No policies: anon/authenticated get zero rows; service role bypasses RLS.

NOTIFY pgrst, 'reload schema';
