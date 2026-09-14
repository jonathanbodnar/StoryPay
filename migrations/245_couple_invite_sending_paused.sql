-- 245_couple_invite_sending_paused.sql
--
-- Additive, expand-only migration for the couple website-invite abuse controls.
-- Adds a per-wedding kill-switch that pauses guest-invite sending. This is the
-- flag flipped automatically on complaint spikes (Resend webhook) and manually
-- by support (admin couples PATCH). Nothing on older deploys reads it, so there
-- is zero risk to existing data; readers default it to false when absent.
--
-- `NOT NULL DEFAULT false` is an instant, no-rewrite change in Postgres 11+.
-- Idempotent (ADD COLUMN IF NOT EXISTS) and ends with a PostgREST schema reload
-- so the API sees the column immediately.

ALTER TABLE public.couple_weddings
  ADD COLUMN IF NOT EXISTS invite_sending_paused boolean NOT NULL DEFAULT false;

-- Let PostgREST / the API pick up the new column right away.
NOTIFY pgrst, 'reload schema';
