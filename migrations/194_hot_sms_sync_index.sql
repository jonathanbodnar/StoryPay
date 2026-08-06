-- Hot-tier inbound SMS sync (src/lib/ghl-inbound-sync-cron.ts) probes
-- conversation_messages every ~7 seconds for SMS activity in the last hour:
--   WHERE channel = 'sms' AND created_at >= <cutoff> ORDER BY created_at DESC
-- This partial index makes that probe an index range scan instead of a
-- sequential scan as the table grows.
CREATE INDEX IF NOT EXISTS idx_conversation_messages_sms_created
  ON public.conversation_messages (created_at DESC)
  WHERE channel = 'sms';
