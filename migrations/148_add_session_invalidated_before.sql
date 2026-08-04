-- Server-side session revocation support.
--
-- A signed session cookie carries its issue time (iat). Setting
-- session_invalidated_before to now() invalidates every session issued before
-- that instant for the given venue / team member — the "force logout" switch.
-- The middleware (src/proxy.ts) compares the cookie's iat against this value
-- (cached ~60s, fail-open) and strips the tenant cookies when the session
-- predates it.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS session_invalidated_before timestamptz;

ALTER TABLE public.venue_team_members
  ADD COLUMN IF NOT EXISTS session_invalidated_before timestamptz;
