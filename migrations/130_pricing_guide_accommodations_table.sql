-- Each accommodation entry gets its own dedicated page in the PDF,
-- exactly like venue_pricing_guide_spaces.
CREATE TABLE IF NOT EXISTS public.venue_pricing_guide_accommodations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_guide_id UUID NOT NULL
    REFERENCES public.venue_pricing_guides(id) ON DELETE CASCADE,
  name        TEXT,
  description TEXT,
  image_url   TEXT,
  position    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_pricing_guide_accommodations_guide_pos_idx
  ON public.venue_pricing_guide_accommodations(pricing_guide_id, position);
