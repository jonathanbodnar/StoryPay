-- ============================================================================
-- 227_couple_sites.sql
--
-- Wedding Minisite: a public, linktree-style wedding page the bride authors in
-- StoryPay and that renders publicly at storyvenue.com/<slug> (weddingdirectory).
--
--   couple_sites               one page per couple (content + slug + toggles)
--   couple_guestbook_entries   well-wishes wall (Phase 2)
--
-- Service-role only (RLS disabled), consistent with the other couple_* tables;
-- all access goes through Next.js API routes (authored by the logged-in bride,
-- read publicly via a StoryPay public API).
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.couple_sites (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id          UUID NOT NULL UNIQUE,
  slug               TEXT UNIQUE,
  is_published       BOOLEAN NOT NULL DEFAULT FALSE,
  headline           TEXT,
  partner_name       TEXT,
  story              TEXT,
  photo_url          TEXT,
  cover_url          TEXT,
  custom_links       JSONB NOT NULL DEFAULT '[]'::jsonb,
  show_countdown     BOOLEAN NOT NULL DEFAULT TRUE,
  show_venue         BOOLEAN NOT NULL DEFAULT TRUE,
  show_guestbook     BOOLEAN NOT NULL DEFAULT TRUE,
  show_registry      BOOLEAN NOT NULL DEFAULT TRUE,
  guestbook_moderated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS couple_sites_slug_idx   ON public.couple_sites (slug);
CREATE INDEX IF NOT EXISTS couple_sites_couple_idx ON public.couple_sites (couple_id);

CREATE TABLE IF NOT EXISTS public.couple_guestbook_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_site_id UUID NOT NULL REFERENCES public.couple_sites(id) ON DELETE CASCADE,
  couple_id      UUID NOT NULL,
  guest_name     TEXT NOT NULL,
  message        TEXT NOT NULL,
  is_hidden      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS couple_guestbook_site_idx ON public.couple_guestbook_entries (couple_site_id, created_at DESC);

-- keep updated_at fresh (same trigger fn used elsewhere)
DROP TRIGGER IF EXISTS set_couple_sites_updated_at ON public.couple_sites;
CREATE TRIGGER set_couple_sites_updated_at
  BEFORE UPDATE ON public.couple_sites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.couple_sites             DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_guestbook_entries DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.couple_sites             TO service_role;
GRANT ALL ON public.couple_guestbook_entries TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
