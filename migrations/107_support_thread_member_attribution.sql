-- 107_support_thread_member_attribution.sql
-- ============================================================================
-- Allow team members (venue_team_members) to open and reply to support
-- tickets, not just owners (auth.users / profiles).
--
-- The original migration 106 made opened_by_profile_id NOT NULL and required
-- support_thread_messages from a venue user to carry sender_profile_id. Team
-- members in this codebase are NOT auth.users — they have their own row in
-- venue_team_members. This migration relaxes those constraints and adds
-- parallel *_member_id columns.
--
-- Idempotent.

-- ── support_threads ─────────────────────────────────────────────────────────
ALTER TABLE public.support_threads
  ADD COLUMN IF NOT EXISTS opened_by_member_id UUID
    REFERENCES public.venue_team_members(id) ON DELETE SET NULL;

-- Drop NOT NULL on opened_by_profile_id (team-member opens leave this NULL)
ALTER TABLE public.support_threads
  ALTER COLUMN opened_by_profile_id DROP NOT NULL;

-- Exactly one of (opened_by_profile_id, opened_by_member_id) must be set.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_threads_opener_match'
  ) THEN
    ALTER TABLE public.support_threads
      ADD CONSTRAINT support_threads_opener_match CHECK (
        (opened_by_profile_id IS NOT NULL AND opened_by_member_id IS NULL) OR
        (opened_by_profile_id IS NULL     AND opened_by_member_id IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS support_threads_opener_member_idx
  ON public.support_threads (opened_by_member_id)
  WHERE opened_by_member_id IS NOT NULL;

-- ── support_thread_messages ────────────────────────────────────────────────
ALTER TABLE public.support_thread_messages
  ADD COLUMN IF NOT EXISTS sender_member_id UUID
    REFERENCES public.venue_team_members(id) ON DELETE SET NULL;

-- Replace the old sender-match CHECK with one that allows venue-sender to be
-- attributed via EITHER sender_profile_id OR sender_member_id (exactly one).
ALTER TABLE public.support_thread_messages
  DROP CONSTRAINT IF EXISTS support_thread_messages_sender_match;

ALTER TABLE public.support_thread_messages
  ADD CONSTRAINT support_thread_messages_sender_match CHECK (
    (
      sender_type = 'venue' AND sender_support_user_id IS NULL AND (
        (sender_profile_id IS NOT NULL AND sender_member_id IS NULL) OR
        (sender_profile_id IS NULL     AND sender_member_id IS NOT NULL)
      )
    ) OR (
      sender_type = 'support'
        AND sender_support_user_id IS NOT NULL
        AND sender_profile_id      IS NULL
        AND sender_member_id       IS NULL
    )
  );

CREATE INDEX IF NOT EXISTS support_thread_messages_sender_member_idx
  ON public.support_thread_messages (sender_member_id)
  WHERE sender_member_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
