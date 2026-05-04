-- ============================================================================
-- Migration 102 — AI Concierge cron heartbeat columns
-- ----------------------------------------------------------------------------
-- Adds two timestamp columns to `ai_runtime_settings` so each cron run can
-- stamp its last successful invocation. The super-admin dashboard reads
-- these and surfaces them as a green/amber/red health badge so an outage
-- (Railway scheduler down, secret rotated, etc.) is visible immediately
-- instead of "huh, why have leads stopped activating?"
--
--   last_activation_cron_at  — hourly cron that promotes dormant leads to
--                              ai_active when 14 days of silence is reached
--   last_send_cron_at        — every-10-min cron that picks the next due
--                              ai_active lead and sends an SMS
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). Safe to re-run.
-- ============================================================================

ALTER TABLE public.ai_runtime_settings
  ADD COLUMN IF NOT EXISTS last_activation_cron_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_send_cron_at       TIMESTAMPTZ NULL;

NOTIFY pgrst, 'reload schema';
