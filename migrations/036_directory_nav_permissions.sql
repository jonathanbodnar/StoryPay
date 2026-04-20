-- Granular dashboard nav: plans store per-route keys in nav_permissions (see src/lib/directory-nav-registry.ts).

BEGIN;

ALTER TABLE public.directory_plans
  ADD COLUMN IF NOT EXISTS nav_permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.directory_plans.nav_permissions IS 'Map of nav id -> boolean from directory-nav-registry; empty {} falls back to legacy feature_flags.';

COMMIT;

NOTIFY pgrst, 'reload schema';
