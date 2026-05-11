-- 132: Web Push subscriptions
--
-- Stores one row per (browser + device) that has opted in to push
-- notifications. The endpoint URL is globally unique across the web — the
-- browser vendor's push service (FCM / WPS / Mozilla autopush) issues it on
-- subscribe() and the same client always reuses it.
--
-- A single venue can have many rows here: every staff member's phone +
-- laptop is its own subscription, identified by its own endpoint. Owners
-- (no member_id cookie) get a row with member_id = NULL.
--
-- All access is via the service-role key from server code — no RLS policies
-- for authenticated/anon roles. The table contains the cryptographic
-- material needed to send to a browser, so it MUST NOT be readable from the
-- client at any time.
--
-- Idempotent: safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id       uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  -- NULL when the venue owner subscribed directly (no team-member session).
  member_id      uuid REFERENCES public.venue_team_members(id) ON DELETE CASCADE,
  -- The browser-issued push endpoint URL. Unique across the entire web.
  endpoint       text NOT NULL UNIQUE,
  -- Client public key (P-256 ECDH) used to encrypt the push payload.
  p256dh         text NOT NULL,
  -- Client auth secret used as additional input to the payload encryption.
  auth           text NOT NULL,
  -- Captured at subscribe time for debugging "why isn't this firing on iOS?".
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  -- Populated when a delivery attempt fails. Two consecutive 410/404
  -- responses from the push service mean the subscription is dead — we
  -- delete the row from app code rather than rely on a periodic sweep.
  last_error     text,
  last_error_at  timestamptz
);

CREATE INDEX IF NOT EXISTS push_subscriptions_venue_id_idx
  ON public.push_subscriptions (venue_id);

CREATE INDEX IF NOT EXISTS push_subscriptions_member_id_idx
  ON public.push_subscriptions (member_id)
  WHERE member_id IS NOT NULL;

-- ── RLS: deny everything by default; only the service role bypasses it. ─────
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Belt-and-braces: even if RLS were ever disabled, no PostgREST role has
-- table grants. Service-role bypasses RLS and table grants alike.
REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;
GRANT  ALL ON public.push_subscriptions TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
