-- 150_pricing_guide_faqs.sql
-- Owner-entered FAQs for the pricing guide.
--
-- The FAQ page is NOT auto-created by onboarding. It only appears in the PDF
-- when the venue manually adds questions here, stored as a JSONB array of
-- { question, answer } objects.

ALTER TABLE public.venue_pricing_guides
  ADD COLUMN IF NOT EXISTS faqs jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
