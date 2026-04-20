-- Venue listing extras: social links, FAQ, map toggle
-- Couples (brides): profiles + saved venues wish list

BEGIN;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS social_links jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS faq jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS show_map boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- Couple profiles (auth.users = couples / brides)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.couple_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text DEFAULT 'US',
  instagram_url text,
  facebook_url text,
  tiktok_url text,
  pinterest_url text,
  wedding_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_couple_profiles_updated ON public.couple_profiles(updated_at DESC);

CREATE TABLE IF NOT EXISTS public.couple_saved_venues (
  couple_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (couple_id, venue_id)
);

CREATE INDEX IF NOT EXISTS idx_couple_saved_venues_couple ON public.couple_saved_venues(couple_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_couple_saved_venues_venue ON public.couple_saved_venues(venue_id);

-- Tables are accessed only from Next.js API (service role), not from browser PostgREST
ALTER TABLE public.couple_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_saved_venues DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.couple_profiles TO service_role;
GRANT ALL ON TABLE public.couple_saved_venues TO service_role;

COMMENT ON TABLE public.couple_profiles IS 'Wedding couple / bride profile; use service role from app API only';
COMMENT ON TABLE public.couple_saved_venues IS 'Wish list: saved venue ids per couple';

COMMIT;
