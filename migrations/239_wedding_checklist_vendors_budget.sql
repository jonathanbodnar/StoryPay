-- Wedding Hub planning tools: checklist, vendor directory, budget.
--
-- Additive-only (expand step from docs/DATA_MIGRATIONS.md): three new JSONB
-- documents on couple_weddings, each defaulting to an empty object so every
-- existing row is valid immediately and readers use the tolerant sanitize*
-- helpers (src/lib/wedding-checklist.ts, wedding-vendors.ts, wedding-budget.ts).
--
--   checklist / vendors — SHARED (couple + venue both read/write, like timeline)
--   budget              — COUPLE-PRIVATE (no venue API route ever selects it)
--
-- Idempotent; safe to re-run.

ALTER TABLE public.couple_weddings
  ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS vendors   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS budget    JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
