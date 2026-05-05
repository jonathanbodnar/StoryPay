-- 108_support_inbox_realtime.sql
-- ============================================================================
-- Adds REPLICA IDENTITY FULL to the conversation + support tables so any
-- future postgres_changes subscriptions carry full row payloads.
--
-- We deliberately do NOT add the tables to the supabase_realtime publication
-- nor grant anon read access. The support inbox + ticket UIs use Realtime
-- *Broadcast* channels (server-side fan-out via supabaseAdmin) instead of
-- postgres_changes subscriptions — Broadcast doesn't require DB access from
-- the browser, so we keep RLS off these tables without exposing them through
-- the anon key.
--
-- Idempotent.

ALTER TABLE public.conversation_messages    REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_threads     REPLICA IDENTITY FULL;
ALTER TABLE public.support_threads          REPLICA IDENTITY FULL;
ALTER TABLE public.support_thread_messages  REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';
