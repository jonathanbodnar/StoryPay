-- migration 116: auto-reopen closed conversation threads when the bride replies
--
-- The Close button on a bride reply thread sets status='closed'. If the
-- bride later sends another SMS or email, that new message should reopen
-- the thread so it shows up in the Needs Reply inbox again.
--
-- We enforce this in the database via a BEFORE INSERT trigger on
-- conversation_messages so the JS path can't forget. Triggers alongside
-- the existing conversation_touch_thread_on_message trigger.

CREATE OR REPLACE FUNCTION public.conversation_reopen_on_inbound()
RETURNS TRIGGER AS $$
BEGIN
  -- Only react to external bride messages
  IF NEW.visibility = 'external' AND NEW.sender_kind = 'contact' THEN
    UPDATE public.conversation_threads
       SET status = 'open'
     WHERE id = NEW.thread_id
       AND status = 'closed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conversation_reopen_on_inbound ON public.conversation_messages;
CREATE TRIGGER trg_conversation_reopen_on_inbound
  AFTER INSERT ON public.conversation_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.conversation_reopen_on_inbound();

-- One-time backfill: any thread currently marked closed but whose latest
-- external message is from the bride should be reopened so the recent
-- replies show up in the inbox immediately after this migration runs.
UPDATE public.conversation_threads t
   SET status = 'open'
  FROM (
    SELECT DISTINCT ON (m.thread_id) m.thread_id, m.sender_kind
      FROM public.conversation_messages m
     WHERE m.visibility = 'external'
     ORDER BY m.thread_id, m.created_at DESC
  ) latest
 WHERE t.id = latest.thread_id
   AND t.status = 'closed'
   AND latest.sender_kind = 'contact';
