-- Migration 131: demo venue support
--
-- is_demo = true  → venue never appears in public directory search,
--                   and its public listing page returns 404 unless the
--                   request carries a valid preview token, a venue-session
--                   cookie matching this venue, or a super-admin cookie.
--
-- demo_preview_token → a stable secret included in shareable demo URLs:
--   storyvenue.com/venue/<slug>?preview=<token>
--   Anyone with the link can see the listing; nobody without it can find it.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS is_demo              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS demo_preview_token   TEXT;

-- Mark the StoryVenue demo account and give it a stable preview token.
UPDATE public.venues
SET
  is_demo            = true,
  demo_preview_token = 'sv_demo_' || encode(gen_random_bytes(18), 'hex')
WHERE slug = 'storyvenue';
