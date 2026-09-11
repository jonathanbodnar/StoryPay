-- ============================================================================
-- 221_bride_portal_phase2.sql
--
-- Bride Portal Phase 2: guest list / RSVP / meal selections + venue-controlled
-- visibility + the bride_portal add-on flag.
--
--   * venues.bride_portal            — add-on checkbox (single source of truth,
--                                       mirrors venue_concierge). Default TRUE:
--                                       the portal is "included" until we decide
--                                       how to package it officially.
--   * venues.bride_portal_visibility — which wedding-data categories the venue
--                                       exposes to the bride. Empty {} means
--                                       "use code defaults" (everything shared).
--   * couple_weddings.meal_options   — bride-defined meal choices for her guests.
--   * wedding_guests                 — the bride-owned guest list. Contact info is
--                                       persisted at the platform level so
--                                       StoryVenue (and the super admin) own it;
--                                       the venue sees planning fields only.
--
-- Service-role access only (mirrors couple_weddings). RLS disabled; the Next.js
-- API enforces couple/venue ownership. Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS bride_portal BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS bride_portal_visibility JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.couple_weddings
  ADD COLUMN IF NOT EXISTS meal_options JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.wedding_guests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_wedding_id  uuid NOT NULL REFERENCES public.couple_weddings(id) ON DELETE CASCADE,
  couple_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  venue_id           uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  venue_customer_id  uuid REFERENCES public.venue_customers(id) ON DELETE SET NULL,

  -- Contact info: platform/super-admin owned. Bride manages it; venue sees
  -- planning fields (below) but not raw contact PII by default.
  full_name          text NOT NULL,
  email              text,
  phone              text,
  address            text,

  -- Planning fields — surfaced to the venue for headcount / catering / BEO.
  party_size         int  NOT NULL DEFAULT 1 CHECK (party_size >= 1 AND party_size <= 30),
  rsvp_status        text NOT NULL DEFAULT 'pending' CHECK (rsvp_status IN ('pending','attending','declined')),
  meal_choice        text,
  dietary_notes      text,
  guest_group        text,
  notes              text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wedding_guests_wedding_idx ON public.wedding_guests (couple_wedding_id);
CREATE INDEX IF NOT EXISTS wedding_guests_venue_idx   ON public.wedding_guests (venue_id);
CREATE INDEX IF NOT EXISTS wedding_guests_couple_idx  ON public.wedding_guests (couple_id);

DROP TRIGGER IF EXISTS trg_wedding_guests_updated_at ON public.wedding_guests;
CREATE TRIGGER trg_wedding_guests_updated_at
  BEFORE UPDATE ON public.wedding_guests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.wedding_guests DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.wedding_guests TO service_role;

COMMENT ON TABLE public.wedding_guests IS
  'Bride-owned wedding guest list (RSVP + meal selections). Contact info persisted at the platform level (StoryVenue / super-admin owned); venue sees planning fields only. Service-role access.';

NOTIFY pgrst, 'reload schema';

COMMIT;
