-- Public gift-registry links on the wedding minisite.
--
-- Additive-only (expand step from docs/DATA_MIGRATIONS.md): a new JSONB array on
-- couple_sites holding [{ label, url }] rows the couple shows publicly. We never
-- host anything — just outbound links (Amazon, Zola, Target, etc.). The existing
-- boolean couple_sites.show_registry gates whether the block renders; the
-- tolerant reader sanitizeRegistryItems() (src/lib/couple-sites.ts) defaults a
-- missing/old value to [], so every existing row stays valid.
--
-- Idempotent; safe to re-run.

ALTER TABLE public.couple_sites
  ADD COLUMN IF NOT EXISTS registry_items JSONB NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
