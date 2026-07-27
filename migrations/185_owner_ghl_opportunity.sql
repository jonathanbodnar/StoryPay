-- 185: Owner GHL opportunity tracking
--
-- Extends the one-way SaaS→GHL sync (see migration 184 + src/lib/owner-ghl-sync.ts)
-- so every synced venue also gets an OPPORTUNITY in the platform owner's dedicated
-- "SaaS Clients" GHL pipeline. The opportunity's stage tracks the venue lifecycle
-- (New Listing → Trial Started / Free Listing → Pro Listing) and moves as the
-- venue progresses.
--
--   owner_ghl_opportunity_id — the opportunity id this venue maps to in the OWNER's
--                              "SaaS Clients" pipeline. Stored so later syncs MOVE
--                              the same card between stages instead of creating a
--                              duplicate opportunity.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS owner_ghl_opportunity_id text;

COMMENT ON COLUMN public.venues.owner_ghl_opportunity_id IS
  'Opportunity id for this venue inside the platform owner''s "SaaS Clients" GHL pipeline (OWNER_GHL_PIPELINE_ID). One-way SaaS→GHL sync target; its stage tracks the venue lifecycle.';
