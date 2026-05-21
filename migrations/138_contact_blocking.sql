-- ============================================================================
-- 138 — Master contacts: blocking + admin notes for every contact source
--
-- The super-admin Contacts page needs to block (temp/perm) and annotate any
-- contact — venue owners, couples, venue team members. Auth-backed accounts
-- already use auth.users.banned_until via Supabase; for non-auth tables we add
-- our own blocked_until + blocked_reason. Notes column lets the admin team
-- record context on any contact (refunded, scammer, VIP, etc.).
--
-- Idempotent.
-- ============================================================================

BEGIN;

-- ── venues (venue owner identity lives on the venues row) ──────────────────
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS blocked_until    timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_reason   text,
  ADD COLUMN IF NOT EXISTS admin_notes      text;

-- ── couple_profiles ────────────────────────────────────────────────────────
ALTER TABLE public.couple_profiles
  ADD COLUMN IF NOT EXISTS blocked_until    timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_reason   text,
  ADD COLUMN IF NOT EXISTS admin_notes      text;

-- ── venue_team_members ─────────────────────────────────────────────────────
-- Already has a `status` column ('invited' | 'active' | 'blocked'). We just
-- add the timestamp + reason + notes columns and let status='blocked' coexist.
ALTER TABLE public.venue_team_members
  ADD COLUMN IF NOT EXISTS phone            text,
  ADD COLUMN IF NOT EXISTS blocked_until    timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_reason   text,
  ADD COLUMN IF NOT EXISTS admin_notes      text;

-- ── support_team_members (admin/staff) ─────────────────────────────────────
ALTER TABLE public.support_team_members
  ADD COLUMN IF NOT EXISTS phone            text,
  ADD COLUMN IF NOT EXISTS admin_notes      text;

COMMENT ON COLUMN public.venues.blocked_until IS
  'When set in the future, venue owner login is blocked until this time. Use a far-future date for permanent blocks.';
COMMENT ON COLUMN public.couple_profiles.blocked_until IS
  'When set in the future, couple login is blocked until this time.';
COMMENT ON COLUMN public.venue_team_members.blocked_until IS
  'When set in the future, this venue team member is blocked from accessing the venue dashboard.';

COMMIT;

NOTIFY pgrst, 'reload schema';
