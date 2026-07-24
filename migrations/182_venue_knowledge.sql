-- 182_venue_knowledge.sql
--
-- AI Concierge venue knowledge base. Truthful, venue-specific amenity facts
-- (spaces, settings, features, accommodations, what packages include) generated
-- by the LLM from listing content + pricing-guide TEXT (never pricing). Cached
-- on the venue row and injected into the AI prompt via {{venue_knowledge}} and
-- {{venue_detail_highlight}}. Auto-managed, not owner-editable.
--
-- HARD RULE: no pricing ever reaches these columns — the generator strips every
-- dollar amount / deposit / price label before and after the LLM step.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS ai_venue_knowledge              text,
  ADD COLUMN IF NOT EXISTS ai_venue_detail_highlight       text,
  ADD COLUMN IF NOT EXISTS ai_venue_knowledge_generated_at timestamptz;

COMMENT ON COLUMN public.venues.ai_venue_knowledge IS
  'AI-generated pricing-free knowledge base of the venue''s real amenities. Injected into the AI Concierge prompt as {{venue_knowledge}}. Auto-managed.';
COMMENT ON COLUMN public.venues.ai_venue_detail_highlight IS
  'AI-generated single best feature to spotlight ({{venue_detail_highlight}}). Never contains pricing. Auto-managed.';
COMMENT ON COLUMN public.venues.ai_venue_knowledge_generated_at IS
  'Timestamp of the last venue-knowledge generation run.';

NOTIFY pgrst, 'reload schema';
