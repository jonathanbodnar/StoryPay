-- 186: Native push device tokens (APNs / FCM)
--
-- The Capacitor native shell (iOS + Android) registers for OS-level push and
-- receives a device token from APNs (iOS) or FCM (Android). This table stores
-- one row per (device + logged-in session) so the server can fan a native push
-- out to every device a venue owner / team member is signed in on — the native
-- counterpart to `push_subscriptions` (web-push, migration 132).
--
--   token      — the opaque APNs/FCM registration token. Globally unique; the
--                OS reissues the same token to the same install, so we upsert
--                on it to avoid duplicate rows.
--   platform   — 'ios' | 'android' (kept as free text + CHECK so a new
--                platform never breaks the insert path).
--   member_id  — NULL when the venue owner registered directly (no team-member
--                session cookie).
--
-- All access is via the service-role key from server code — no RLS policies
-- for authenticated/anon roles. The token can be used to push to a user's
-- device, so it MUST NOT be readable from the client.
--
-- Idempotent: safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id       uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  -- NULL when the venue owner registered directly (no team-member session).
  member_id      uuid REFERENCES public.venue_team_members(id) ON DELETE CASCADE,
  -- APNs / FCM registration token. Unique across the fleet.
  token          text NOT NULL UNIQUE,
  -- 'ios' | 'android'.
  platform       text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_tokens_venue_id_idx
  ON public.device_tokens (venue_id);

CREATE INDEX IF NOT EXISTS device_tokens_member_id_idx
  ON public.device_tokens (member_id)
  WHERE member_id IS NOT NULL;

-- ── RLS: deny everything by default; only the service role bypasses it. ─────
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

-- Belt-and-braces: even if RLS were ever disabled, no PostgREST role has
-- table grants. Service-role bypasses RLS and table grants alike.
REVOKE ALL ON public.device_tokens FROM anon, authenticated;
GRANT  ALL ON public.device_tokens TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
