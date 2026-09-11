-- ============================================================================
-- 224_wedding_tables.sql
--
-- Seating charts / table assignments for the Bride Portal.
--
-- The bride creates tables for her reception and assigns guest parties to them.
-- Seats used by a table = sum of party_size of its assigned guests. Capacity is
-- informational (drives an "over capacity" warning in the UI).
--
--   wedding_tables            one row per reception table
--   wedding_guests.table_id   which table a guest party is seated at (nullable)
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.wedding_tables (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_wedding_id UUID NOT NULL REFERENCES public.couple_weddings(id) ON DELETE CASCADE,
  couple_id         UUID,
  venue_id          UUID,
  name              TEXT NOT NULL,
  capacity          INTEGER NOT NULL DEFAULT 8,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wedding_tables_wedding_idx ON public.wedding_tables (couple_wedding_id);
CREATE INDEX IF NOT EXISTS wedding_tables_couple_idx  ON public.wedding_tables (couple_id);

-- Which table a guest party sits at. ON DELETE SET NULL so deleting a table
-- simply unassigns its guests rather than removing them.
ALTER TABLE public.wedding_guests
  ADD COLUMN IF NOT EXISTS table_id UUID REFERENCES public.wedding_tables(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS wedding_guests_table_idx ON public.wedding_guests (table_id);

-- keep updated_at fresh (same trigger fn used elsewhere)
DROP TRIGGER IF EXISTS set_wedding_tables_updated_at ON public.wedding_tables;
CREATE TRIGGER set_wedding_tables_updated_at
  BEFORE UPDATE ON public.wedding_tables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Bride Portal tables are service-role only (accessed via API with the couple's
-- verified identity); no direct client access.
ALTER TABLE public.wedding_tables DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.wedding_tables TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
