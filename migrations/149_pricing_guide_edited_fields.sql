-- 149_pricing_guide_edited_fields.sql
-- Manual-override tracking for the pricing guide.
--
-- `edited_fields` is a JSONB map of { field_name: true } recording which guide
-- fields the venue owner has manually edited. The onboarding `draft-guide`
-- regeneration and the Google import only populate fields that are empty AND
-- have never been user-edited, so manual content always wins.

ALTER TABLE public.venue_pricing_guides
  ADD COLUMN IF NOT EXISTS edited_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
