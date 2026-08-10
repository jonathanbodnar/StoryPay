-- 200: Owner GHL stage sync tracking + fix "Pro Listing" → "Paid Listing" drift
--
-- Context: the live GHL "SaaS Clients" pipeline stage is named "Paid Listing",
-- but src/lib/owner-ghl-sync.ts was resolving stages by the name "Pro Listing".
-- resolveOwnerPipeline() requires ALL 4 stage names to match or it returns
-- null and skips opportunity placement entirely — so this one wrong name was
-- silently blocking every venue's opportunity create/move, not just paid ones.
-- That code bug is fixed alongside this migration; these two columns let the
-- new periodic reconciler (reconcileOwnerGhlStages) skip venues that are
-- already in sync instead of re-syncing all venues against GHL on every run.
--
--   owner_ghl_synced_stage  — the pipeline stage NAME last successfully
--                             written to this venue's GHL opportunity.
--   owner_ghl_synced_status — the opportunity status ('open'/'lost') last
--                             successfully written (tracks cancellations).

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS owner_ghl_synced_stage text,
  ADD COLUMN IF NOT EXISTS owner_ghl_synced_status text;

COMMENT ON COLUMN public.venues.owner_ghl_synced_stage IS
  'Last pipeline stage name successfully synced to this venue''s opportunity in the owner''s "SaaS Clients" GHL pipeline. Used by reconcileOwnerGhlStages() to skip already-in-sync venues.';
COMMENT ON COLUMN public.venues.owner_ghl_synced_status IS
  'Last opportunity status (''open''/''lost'') successfully synced for this venue — ''lost'' means the subscription was canceled.';
