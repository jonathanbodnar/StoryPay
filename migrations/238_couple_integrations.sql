-- ============================================================================
-- 238_couple_integrations.sql
--
-- Per-couple (bride) third-party integration connections — mirrors the venue
-- side `venue_integrations` table, but keyed by the couple's auth user id.
--
-- First consumer: Pinterest OAuth for the Wedding Hub inspiration board. Tokens
-- are stored via the app's crypto-tokens helper (AES-256-GCM when
-- TOKEN_ENCRYPTION_KEY is set, otherwise a plaintext fallback), and are only
-- ever read through the service role — RLS is enabled with no anon/authenticated
-- policies so the table is not directly reachable by client sessions.
--
-- Additive + idempotent — safe to re-run.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.couple_integrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider          text NOT NULL,
  access_token      text,
  refresh_token     text,
  token_expires_at  timestamptz,
  scope             text,
  provider_user_id  text,
  provider_username text,
  connected_at      timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (couple_id, provider)
);

CREATE INDEX IF NOT EXISTS couple_integrations_couple_id_idx
  ON public.couple_integrations (couple_id);

ALTER TABLE public.couple_integrations ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;
