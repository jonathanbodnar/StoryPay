-- SMS threads via Go High Level: reply channel + idempotent message ids + list RPC phone

ALTER TABLE public.conversation_threads
  ADD COLUMN IF NOT EXISTS external_reply_channel text NOT NULL DEFAULT 'email';

ALTER TABLE public.conversation_threads
  DROP CONSTRAINT IF EXISTS conversation_threads_external_reply_channel_chk;

ALTER TABLE public.conversation_threads
  ADD CONSTRAINT conversation_threads_external_reply_channel_chk
  CHECK (external_reply_channel IN ('email', 'sms'));

COMMENT ON COLUMN public.conversation_threads.external_reply_channel IS
  'email: external composer sends StoryPay email. sms: composer sends via GHL Conversations SMS (A2P on GHL side).';

ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS ghl_message_id text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_ghl_message_id_key
  ON public.conversation_messages (ghl_message_id)
  WHERE ghl_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS venue_customers_venue_ghl_contact_idx
  ON public.venue_customers (venue_id, ghl_contact_id)
  WHERE ghl_contact_id IS NOT NULL;

-- Extend list RPC with contact phone (for SMS threads in sidebar)
-- RETURNS TABLE column list changed vs 022: must DROP first (42P13 otherwise).
DROP FUNCTION IF EXISTS public.conversation_threads_with_meta(uuid, text, boolean, integer);

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
  contact_email text,
  contact_phone text,
  external_reply_channel text
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
    vc.customer_email,
    vc.phone,
    t.external_reply_channel
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

NOTIFY pgrst, 'reload schema';
