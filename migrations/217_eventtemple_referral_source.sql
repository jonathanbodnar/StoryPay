-- Migration 217: Event Temple referral source mapping per venue
-- Adds one nullable column to venues so a venue can map StoryVenue leads to a
-- native Event Temple "Referral Source" (fills the booking's Referral Source
-- field instead of only recording the source in a note):
--   eventtemple_referral_source_id — the selected Event Temple referral source id;
--                                    sent as referral_source_id on each booking.
-- Nullable; NULL means "don't set a native referral source" (source stays in the note).

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS eventtemple_referral_source_id TEXT DEFAULT NULL;
