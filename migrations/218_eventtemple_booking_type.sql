-- Migration 218: Event Temple booking type mapping per venue
-- Adds one nullable column to venues so a venue can map StoryVenue leads to a
-- native Event Temple "Booking Type" (fills the booking's Booking Type field):
--   eventtemple_booking_type_id — the selected Event Temple booking type id;
--                                 sent as booking_type_id on each booking.
-- Nullable; NULL means "auto-match by name (e.g. Wedding) or leave unset".

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS eventtemple_booking_type_id TEXT DEFAULT NULL;
