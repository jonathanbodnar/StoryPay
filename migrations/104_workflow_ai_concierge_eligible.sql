-- Migration 104: AI Concierge eligibility flag on workflows
-- ============================================================================
-- Adds a per-workflow toggle so venues can control which of their automations
-- feeds into the AI Concierge activation pipeline.
--
-- Default: TRUE — all existing workflows preserve their current activation
-- behaviour. Venues turn it OFF for workflows that should NOT trigger AI
-- outreach (post-tour follow-ups, anniversary emails, etc.).
--
-- The AI activation cron now requires:
--   • The lead was enrolled in at least one ai_concierge_eligible workflow, OR
--   • The lead has no workflow enrollment at all (manually-created leads, legacy)
-- This prevents the AI from activating leads that are mid-way through a
-- non-inquiry workflow (e.g. they already toured the venue).
-- ============================================================================

ALTER TABLE public.marketing_automations
  ADD COLUMN IF NOT EXISTS ai_concierge_eligible BOOLEAN NOT NULL DEFAULT true;

NOTIFY pgrst, 'reload schema';
