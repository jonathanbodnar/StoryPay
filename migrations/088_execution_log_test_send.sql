-- 088_execution_log_test_send.sql
-- Add columns to marketing_automation_execution_logs so we can record
-- "Send Test" runs (test email / test SMS) alongside real workflow executions.
--
--   is_test          true when the row was produced by a Send Test button
--   test_recipient   email or phone the test was delivered to (when is_test = true)
--
-- The execution-logs table never had a NOT NULL on enrollment_id or lead_id,
-- so test rows can be inserted with those fields nulled out.

ALTER TABLE public.marketing_automation_execution_logs
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

ALTER TABLE public.marketing_automation_execution_logs
  ADD COLUMN IF NOT EXISTS test_recipient text;

CREATE INDEX IF NOT EXISTS mael_is_test_idx
  ON public.marketing_automation_execution_logs (automation_id, executed_at DESC)
  WHERE is_test = true;

NOTIFY pgrst, 'reload schema';
