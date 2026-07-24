-- Migration 178: AI Concierge overhaul — admin override + followup mover support
--
-- 1. ai_concierge_admin_disabled — super admin force-off. When true, the venue
--    has NO AI Concierge access even if their plan bundles it or the addon is
--    purchased. Toggled from the Venue Management card in super admin.
--
-- 2. followup_moved_at — stamp on leads when the universal 14-day inactivity
--    mover placed them in the Followup stage, so the cron never double-moves
--    the same lead.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS ai_concierge_admin_disabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS followup_moved_at timestamptz;

-- Sparse index for the mover cron: only leads not yet moved matter.
CREATE INDEX IF NOT EXISTS leads_followup_mover_idx
  ON public.leads (venue_id, created_at)
  WHERE followup_moved_at IS NULL;

-- 3. Relax the AI eligibility CHECK constraint. Concierge access is now
--    multi-path (addon purchased OR plan bundles it OR legacy/no-plan) and is
--    enforced in application logic + the cron SQL guards, so the constraint
--    only keeps the A2P requirement. The old constraint required
--    directory_addon_concierge = TRUE which blocks plan-bundled venues.
ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS venues_ai_concierge_eligibility_check;

ALTER TABLE public.venues
  ADD CONSTRAINT venues_ai_concierge_eligibility_check
  CHECK (
    NOT ai_concierge_enabled
    OR a2p_verified = TRUE
  );
