-- 111_support_owner_no_profile.sql
-- ============================================================================
-- Allow venue owners to open and reply to support tickets even when they have
-- no profiles / auth.users row.
--
-- Background: StoryVenue authenticates venue owners with email + bcrypt
-- password against `venues.password_hash`. Those owners do NOT have a
-- corresponding `auth.users` (and therefore no `profiles`) row, which means
-- `venues.owner_id` is NULL for the vast majority of accounts. Migration 106
-- required `opened_by_profile_id` to be set for owner-opened tickets, and
-- migration 107 added a `member_id` path for team members but kept a strict
-- "exactly one of (profile_id, member_id) must be set" CHECK. This locks
-- non-team-member owners out of opening tickets — exactly the symptom the
-- user is hitting on /dashboard/profile.
--
-- Fix: relax the CHECK so BOTH columns can be NULL when the venue owner has
-- no profiles row. Display attribution falls back to venues.email/name
-- in the API/UI layer.
--
-- Idempotent. Safe to re-run.

-- ── support_threads opener constraint ──────────────────────────────────────
ALTER TABLE public.support_threads
  DROP CONSTRAINT IF EXISTS support_threads_opener_match;

ALTER TABLE public.support_threads
  ADD CONSTRAINT support_threads_opener_match CHECK (
    -- Either profile-only (legacy owners with auth.users)
    (opened_by_profile_id IS NOT NULL AND opened_by_member_id IS NULL) OR
    -- Or member-only (team members)
    (opened_by_profile_id IS NULL     AND opened_by_member_id IS NOT NULL) OR
    -- Or neither (owner without profile — attribution falls back to venue)
    (opened_by_profile_id IS NULL     AND opened_by_member_id IS NULL)
  );

-- ── support_thread_messages sender constraint ──────────────────────────────
-- Mirror the relaxation for venue-side replies on existing tickets.
ALTER TABLE public.support_thread_messages
  DROP CONSTRAINT IF EXISTS support_thread_messages_sender_match;

ALTER TABLE public.support_thread_messages
  ADD CONSTRAINT support_thread_messages_sender_match CHECK (
    (
      sender_type = 'venue' AND sender_support_user_id IS NULL AND (
        -- profile-only
        (sender_profile_id IS NOT NULL AND sender_member_id IS NULL) OR
        -- member-only
        (sender_profile_id IS NULL     AND sender_member_id IS NOT NULL) OR
        -- neither (owner without profile)
        (sender_profile_id IS NULL     AND sender_member_id IS NULL)
      )
    ) OR (
      sender_type = 'support'
        AND sender_support_user_id IS NOT NULL
        AND sender_profile_id      IS NULL
        AND sender_member_id       IS NULL
    )
  );

NOTIFY pgrst, 'reload schema';
