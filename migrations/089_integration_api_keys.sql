-- 089_integration_api_keys.sql
-- Adds tables for the public StoryVenue integrations API:
--   * venue_api_keys             — per-venue Bearer-token credentials (Zapier, etc.)
--   * venue_webhook_subscriptions — REST Hook targets for instant Zapier triggers
--   * venue_integration_events   — short audit log of events we dispatched
--
-- All three are venue-scoped and cascade on venue delete.

------------------------------------------------------------------------------
-- 1. API keys
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.venue_api_keys (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  -- Display label chosen by the user (e.g. "Zapier", "n8n", "My laptop")
  name          text        NOT NULL DEFAULT 'API key',
  -- First 12 chars of the secret, shown in the UI for identification
  key_prefix    text        NOT NULL,
  -- SHA-256 hex of the full secret. The plaintext is shown ONCE on creation.
  key_hash      text        NOT NULL UNIQUE,
  -- Optional source label so we can show "Created by Zapier" automatically
  source        text        NOT NULL DEFAULT 'manual',
  scopes        text[]      NOT NULL DEFAULT ARRAY['read','write']::text[],
  last_used_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);

CREATE INDEX IF NOT EXISTS venue_api_keys_venue_id_idx
  ON public.venue_api_keys (venue_id);
CREATE INDEX IF NOT EXISTS venue_api_keys_active_idx
  ON public.venue_api_keys (venue_id) WHERE revoked_at IS NULL;

------------------------------------------------------------------------------
-- 2. Webhook subscriptions (REST Hooks for instant Zapier triggers)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.venue_webhook_subscriptions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  api_key_id    uuid        REFERENCES public.venue_api_keys(id) ON DELETE CASCADE,
  -- One of: lead.created, contact.created, contact.updated, tag.added,
  --        proposal.signed, payment.received, appointment.booked,
  --        appointment.cancelled, form.submitted
  event_type    text        NOT NULL,
  -- Where we POST the event payload
  target_url    text        NOT NULL,
  -- Free-form label ("Zapier" by default)
  source        text        NOT NULL DEFAULT 'zapier',
  active        boolean     NOT NULL DEFAULT true,
  last_fired_at timestamptz,
  fail_count    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_webhook_subs_venue_id_idx
  ON public.venue_webhook_subscriptions (venue_id);
CREATE INDEX IF NOT EXISTS venue_webhook_subs_event_idx
  ON public.venue_webhook_subscriptions (venue_id, event_type) WHERE active;

------------------------------------------------------------------------------
-- 3. Integration event log (best-effort audit trail; trimmed via cron)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.venue_integration_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  event_type    text        NOT NULL,
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Number of webhook subscribers we attempted to notify
  fanout        integer     NOT NULL DEFAULT 0,
  -- Number that responded with 2xx
  delivered     integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_integration_events_venue_id_idx
  ON public.venue_integration_events (venue_id, created_at DESC);
