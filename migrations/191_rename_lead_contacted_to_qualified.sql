-- Rename the default-pipeline "Lead Contacted" stage to "Qualified" for every
-- already-provisioned venue. New venues get "Qualified" from
-- DEFAULT_STAGE_TEMPLATE (src/lib/pipelines.ts) going forward — this
-- migration backfills existing data so both are in sync.
--
-- Scoped precisely to default-pipeline, open-kind stages named exactly
-- "Lead Contacted" so a venue's custom (non-default) pipeline that happens to
-- also have a stage called "Lead Contacted" for unrelated reasons is never
-- touched. Verified against production (brxnhsaakmhgwcthcapd) on 2026-08-05:
-- 37 default-pipeline stages match this WHERE clause; exactly 1 non-default
-- pipeline stage named "Lead Contacted" exists and is correctly excluded.
UPDATE lead_pipeline_stages
SET name = 'Qualified',
    updated_at = now()
WHERE name = 'Lead Contacted'
  AND kind = 'open'
  AND pipeline_id IN (SELECT id FROM lead_pipelines WHERE is_default = true);
