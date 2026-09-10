-- Migration 219: concurrency lease for marketing automation enrollments
--
-- Root cause of duplicate automated messages: the marketing cron
-- (processAutomationEnrollmentsBatch) selected active, due enrollments and
-- SENT the step *before* advancing current_step_index, with no atomic claim.
-- The cron endpoint is triggered by multiple overlapping sources (Railway cron,
-- GitHub Actions backup, and a 60s self-ping), so two invocations could select
-- the same enrollment and both send the same step (confirmed: same enrollment_id
-- + step_order logged twice ~0.8s apart).
--
-- Fix: a per-enrollment lease. A worker atomically claims an enrollment by
-- setting locked_until into the future (conditioned on the lock being null or
-- expired); only one concurrent worker's UPDATE matches, so exactly one worker
-- processes the enrollment. The lease auto-expires so a crashed worker's
-- enrollment resumes on a later tick.

ALTER TABLE marketing_automation_enrollments
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ DEFAULT NULL;
