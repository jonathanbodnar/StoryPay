-- 106_support_inbox.sql — Unified Support Inbox
-- ============================================================================
-- Adds the schema for the StoryVenue support workspace at /admin/support.
--
-- Sections:
--   1. conversation_messages — 3 new columns + extend sender_kind to include 'concierge'
--   2. ai_concierge_touch_lead_message_timestamps — extend trigger to count
--      'concierge' as outbound (so a support reply clears the bride-inbox flag)
--   3. support_team_members — limited-access agents who can log in to the
--      super admin support workspace
--   4. support_threads — venue-owner ↔ StoryVenue support tickets
--   5. support_thread_messages — message history for each ticket
--   6. Indexes + service_role grants
--
-- Idempotent: safe to re-run.

-- ============================================================================
-- 1. conversation_messages
-- ============================================================================
ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS sent_by_support_user_id   UUID,
  ADD COLUMN IF NOT EXISTS sent_on_behalf_of_venue   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS support_internal_note     TEXT;

-- Extend sender_kind to allow 'concierge' (StoryVenue support replying as the venue)
ALTER TABLE public.conversation_messages
  DROP CONSTRAINT IF EXISTS conversation_messages_sender_kind_check;

ALTER TABLE public.conversation_messages
  ADD CONSTRAINT conversation_messages_sender_kind_check
  CHECK (sender_kind IN ('owner', 'team', 'contact', 'system', 'ai', 'concierge'));

-- A 'concierge' message must carry a sent_by_support_user_id; venue_team_member_id stays NULL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversation_messages_concierge_sender'
  ) THEN
    ALTER TABLE public.conversation_messages
      ADD CONSTRAINT conversation_messages_concierge_sender CHECK (
        (sender_kind <> 'concierge') OR (sent_by_support_user_id IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS conversation_messages_concierge_idx
  ON public.conversation_messages (sent_by_support_user_id)
  WHERE sent_by_support_user_id IS NOT NULL;

-- ============================================================================
-- 2. Extend trigger: 'concierge' counts as outbound
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ai_concierge_touch_lead_message_timestamps()
RETURNS TRIGGER AS $$
DECLARE
  v_venue_id UUID;
  v_email    TEXT;
BEGIN
  SELECT vc.venue_id, vc.customer_email
    INTO v_venue_id, v_email
    FROM public.conversation_threads ct
    JOIN public.venue_customers vc ON vc.id = ct.venue_customer_id
   WHERE ct.id = NEW.thread_id;

  IF v_venue_id IS NULL OR v_email IS NULL OR v_email = '' THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_kind = 'contact' THEN
    UPDATE public.leads
       SET last_inbound_at = NEW.created_at
     WHERE venue_id = v_venue_id
       AND lower(email) = lower(v_email);
  ELSIF NEW.sender_kind IN ('owner', 'team', 'system', 'ai', 'concierge') THEN
    UPDATE public.leads
       SET last_outbound_at = NEW.created_at
     WHERE venue_id = v_venue_id
       AND lower(email) = lower(v_email);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. support_team_members — limited-access agents for /admin/support
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.support_team_members (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT        NOT NULL UNIQUE,
  name            TEXT        NOT NULL,
  password_hash   TEXT        NOT NULL,
  role            TEXT        NOT NULL DEFAULT 'support_agent'
                              CHECK (role IN ('support_agent', 'support_admin')),
  active          BOOLEAN     NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_team_members_active_idx
  ON public.support_team_members (active) WHERE active = TRUE;

DROP TRIGGER IF EXISTS trg_support_team_members_updated_at ON public.support_team_members;
CREATE TRIGGER trg_support_team_members_updated_at
  BEFORE UPDATE ON public.support_team_members
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Now wire the FK on conversation_messages.sent_by_support_user_id (deferred
-- until support_team_members exists so this migration is self-contained).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversation_messages_support_user_fk'
  ) THEN
    ALTER TABLE public.conversation_messages
      ADD CONSTRAINT conversation_messages_support_user_fk
      FOREIGN KEY (sent_by_support_user_id)
      REFERENCES public.support_team_members(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- 4. support_threads — venue ↔ StoryVenue support tickets
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.support_threads (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id                   UUID        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  -- Any logged-in venue user (owner OR team member) can open a ticket; this is
  -- their auth.users id (matches public.profiles.id).
  opened_by_profile_id       UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject                    TEXT        NOT NULL DEFAULT 'Support request',
  status                     TEXT        NOT NULL DEFAULT 'open'
                                          CHECK (status IN ('open', 'pending', 'closed')),
  priority                   TEXT        NOT NULL DEFAULT 'normal'
                                          CHECK (priority IN ('low', 'normal', 'high')),
  assigned_support_user_id   UUID        REFERENCES public.support_team_members(id) ON DELETE SET NULL,
  last_message_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_preview       TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_threads_venue_idx
  ON public.support_threads (venue_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS support_threads_status_idx
  ON public.support_threads (status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS support_threads_assigned_idx
  ON public.support_threads (assigned_support_user_id, status)
  WHERE assigned_support_user_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_support_threads_updated_at ON public.support_threads;
CREATE TRIGGER trg_support_threads_updated_at
  BEFORE UPDATE ON public.support_threads
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 5. support_thread_messages — message history
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.support_thread_messages (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  support_thread_id          UUID        NOT NULL REFERENCES public.support_threads(id) ON DELETE CASCADE,
  -- 'venue' = sent by a venue user (owner or team member)
  -- 'support' = sent by a StoryVenue support agent
  sender_type                TEXT        NOT NULL CHECK (sender_type IN ('venue', 'support')),
  -- Exactly one of these is non-null; the CHECK below enforces it.
  sender_profile_id          UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_support_user_id     UUID        REFERENCES public.support_team_members(id) ON DELETE SET NULL,
  body                       TEXT        NOT NULL,
  attachments                JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT support_thread_messages_sender_match CHECK (
    (sender_type = 'venue'   AND sender_profile_id      IS NOT NULL AND sender_support_user_id IS NULL) OR
    (sender_type = 'support' AND sender_support_user_id IS NOT NULL AND sender_profile_id      IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS support_thread_messages_thread_idx
  ON public.support_thread_messages (support_thread_id, created_at ASC);

-- Touch parent thread on new message (mirrors conversation_threads pattern)
CREATE OR REPLACE FUNCTION public.support_threads_touch_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.support_threads
     SET last_message_at      = NEW.created_at,
         last_message_preview = LEFT(NEW.body, 240),
         updated_at           = now()
   WHERE id = NEW.support_thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_support_thread_messages_touch_thread ON public.support_thread_messages;
CREATE TRIGGER trg_support_thread_messages_touch_thread
  AFTER INSERT ON public.support_thread_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.support_threads_touch_on_message();

-- ============================================================================
-- 6. RLS / grants — service-role only, gated at API layer (matches
--    conversation_threads pattern from migration 022)
-- ============================================================================
ALTER TABLE public.support_team_members      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_threads           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_thread_messages   DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_team_members    TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_threads         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_thread_messages TO service_role;

NOTIFY pgrst, 'reload schema';
