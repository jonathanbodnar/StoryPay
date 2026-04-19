-- ============================================================================
-- 022_conversations.sql — Unified inbox threads (email now; SMS channel stub)
-- Strict visibility: internal (team-only) vs external (client-visible / sent email)
-- Idempotent — safe to re-run.
-- ============================================================================

-- ─── Threads (one or more per venue + contact) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversation_threads (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id             uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  venue_customer_id    uuid NOT NULL REFERENCES public.venue_customers(id) ON DELETE CASCADE,
  subject              text        NOT NULL DEFAULT 'Conversation',
  last_message_at      timestamptz NOT NULL DEFAULT now(),
  last_message_preview text,
  last_message_visibility text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_threads_venue_last_idx
  ON public.conversation_threads (venue_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS conversation_threads_venue_customer_idx
  ON public.conversation_threads (venue_id, venue_customer_id);

-- ─── Messages ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id             uuid NOT NULL REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
  visibility            text NOT NULL CHECK (visibility IN ('internal', 'external')),
  channel               text NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms')),
  body                  text NOT NULL,
  sender_kind           text NOT NULL CHECK (sender_kind IN ('owner', 'team', 'contact', 'system')),
  venue_team_member_id  uuid REFERENCES public.venue_team_members(id) ON DELETE SET NULL,
  contact_from_name     text,
  contact_from_email    text,
  mentioned_member_ids  uuid[] NOT NULL DEFAULT '{}',
  external_email_sent   boolean DEFAULT false,
  send_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_messages_team_sender CHECK (
    (sender_kind <> 'team') OR (venue_team_member_id IS NOT NULL)
  ),
  CONSTRAINT conversation_messages_owner_sender CHECK (
    (sender_kind <> 'owner') OR (venue_team_member_id IS NULL)
  ),
  CONSTRAINT conversation_messages_contact_sender CHECK (
    (sender_kind <> 'contact') OR (venue_team_member_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS conversation_messages_thread_created_idx
  ON public.conversation_messages (thread_id, created_at ASC);

-- ─── Per-reader read state (owner uses reader_ref = 'owner') ───────────────
CREATE TABLE IF NOT EXISTS public.conversation_thread_reads (
  thread_id    uuid NOT NULL REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
  reader_ref   text NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, reader_ref)
);

CREATE INDEX IF NOT EXISTS conversation_thread_reads_reader_idx
  ON public.conversation_thread_reads (reader_ref);

-- ─── Touch thread summary on new message ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.conversation_touch_thread_on_message()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.conversation_threads
  SET
    last_message_at = NEW.created_at,
    last_message_preview = LEFT(NEW.body, 240),
    last_message_visibility = NEW.visibility,
    updated_at = now()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversation_messages_touch_thread ON public.conversation_messages;
CREATE TRIGGER trg_conversation_messages_touch_thread
  AFTER INSERT ON public.conversation_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.conversation_touch_thread_on_message();

DROP TRIGGER IF EXISTS trg_conversation_threads_updated_at ON public.conversation_threads;
CREATE TRIGGER trg_conversation_threads_updated_at
  BEFORE UPDATE ON public.conversation_threads
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ─── List helper (unread + contact in one round-trip) ───────────────────────
CREATE OR REPLACE FUNCTION public.conversation_threads_with_meta(
  p_venue_id uuid,
  p_reader_ref text,
  p_unread_only boolean DEFAULT false,
  p_limit int DEFAULT 100
)
RETURNS TABLE (
  thread_id uuid,
  venue_id uuid,
  venue_customer_id uuid,
  subject text,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_visibility text,
  unread_count bigint,
  contact_first_name text,
  contact_last_name text,
  contact_email text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    t.id,
    t.venue_id,
    t.venue_customer_id,
    t.subject,
    t.last_message_at,
    t.last_message_preview,
    t.last_message_visibility,
    (
      SELECT COUNT(*)::bigint
      FROM public.conversation_messages m
      WHERE m.thread_id = t.id
        AND m.created_at > COALESCE(
          (
            SELECT r.last_read_at
            FROM public.conversation_thread_reads r
            WHERE r.thread_id = t.id AND r.reader_ref = p_reader_ref
          ),
          '-infinity'::timestamptz
        )
    ) AS unread_count,
    vc.first_name,
    vc.last_name,
    vc.customer_email
  FROM public.conversation_threads t
  INNER JOIN public.venue_customers vc ON vc.id = t.venue_customer_id
  WHERE t.venue_id = p_venue_id
    AND (
      NOT p_unread_only
      OR (
        SELECT COUNT(*)::bigint
        FROM public.conversation_messages m
        WHERE m.thread_id = t.id
          AND m.created_at > COALESCE(
            (
              SELECT r.last_read_at
              FROM public.conversation_thread_reads r
              WHERE r.thread_id = t.id AND r.reader_ref = p_reader_ref
            ),
            '-infinity'::timestamptz
          )
      ) > 0
    )
  ORDER BY t.last_message_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.conversation_threads_with_meta(uuid, text, boolean, int)
  TO service_role, authenticated;

-- Access only via server (service role); avoid broad RLS policies
ALTER TABLE public.conversation_threads DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_thread_reads DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_threads TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_messages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_thread_reads TO service_role;

NOTIFY pgrst, 'reload schema';
