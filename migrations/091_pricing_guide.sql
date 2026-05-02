-- Pricing & Availability Guide — high-tier feature for venues to publish a
-- multi-section guide that brides can download from the public listing page.
--
-- The guide itself is one row per venue. Spaces (multiple rooms/areas the
-- venue rents) and Packages (pricing tiers) are child tables so they can be
-- ordered, added, edited, and removed independently. Reviews and the photo
-- gallery are stored as JSONB on the parent row because they are simple
-- {url, caption} / {author, body, rating} records that don't need their own
-- foreign key relationships.

CREATE TABLE IF NOT EXISTS public.venue_pricing_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL UNIQUE
    REFERENCES public.venues(id) ON DELETE CASCADE,

  -- Master toggle: when TRUE the public listing shows the cover image +
  -- "Download Pricing & Availability Guide" CTA. When FALSE the guide is
  -- saved but invisible to brides.
  enabled BOOLEAN NOT NULL DEFAULT FALSE,

  -- AI-generated front cover (Playfair "Pricing & Availability Guide" title +
  -- venue logo overlaid on a portrait venue image). Filled by a separate
  -- generation job; nullable until first run.
  cover_image_url TEXT,
  cover_generated_at TIMESTAMPTZ,
  cover_source_image_url TEXT,           -- venue photo we used as the seed

  -- Welcome / congratulatory page (page 2 of the guide)
  congratulatory_message TEXT,

  -- Photo gallery page — JSONB array of { url, caption } objects, ordered.
  gallery JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- About the venue (rich text / markdown)
  about_venue TEXT,

  -- Accommodations (lodging, getting-ready suites, etc.)
  accommodations_text TEXT,
  accommodations_image_url TEXT,

  -- Pricing & packages page intro (the per-package cards live in
  -- venue_pricing_guide_packages below)
  pricing_intro TEXT,

  -- Reviews — JSONB array of { author, location, body, rating } objects.
  reviews JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Availability page text + optional uploaded calendar/photo
  availability_text TEXT,
  availability_image_url TEXT,

  -- Save the date / Call-to-action page
  cta_headline TEXT,
  cta_body TEXT,
  cta_button_label TEXT NOT NULL DEFAULT 'Schedule a tour',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_pricing_guides_venue_idx
  ON public.venue_pricing_guides(venue_id);

COMMENT ON TABLE public.venue_pricing_guides IS
  'One row per venue. Holds the data for the AI-generated Pricing & Availability Guide PDF and its on-page lead magnet.';

-- ── Spaces (CRUD on a child table because each entry has an image + ordering)
CREATE TABLE IF NOT EXISTS public.venue_pricing_guide_spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_guide_id UUID NOT NULL
    REFERENCES public.venue_pricing_guides(id) ON DELETE CASCADE,
  name TEXT,
  description TEXT,
  capacity TEXT,                         -- free-form: "Up to 200 guests"
  image_url TEXT,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_pricing_guide_spaces_guide_pos_idx
  ON public.venue_pricing_guide_spaces(pricing_guide_id, position);

-- ── Packages (CRUD with included-items list)
CREATE TABLE IF NOT EXISTS public.venue_pricing_guide_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_guide_id UUID NOT NULL
    REFERENCES public.venue_pricing_guides(id) ON DELETE CASCADE,
  name TEXT,
  price_label TEXT,                      -- "$5,000+" / "Starting at $X" etc.
  description TEXT,
  included_items JSONB NOT NULL DEFAULT '[]'::jsonb, -- array of strings
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_pricing_guide_packages_guide_pos_idx
  ON public.venue_pricing_guide_packages(pricing_guide_id, position);
