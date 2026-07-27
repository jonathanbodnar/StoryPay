-- 184: Owner GHL venue sync + new-listing alert tracking
--
-- Supports one-way sync of SaaS venues (StoryVenue's own customers) into the
-- platform owner's GoHighLevel sub-account, plus a "new listing went live"
-- SMS alert to the owner.
--
--   owner_ghl_contact_id      — the contact id this venue maps to in the OWNER's
--                               GHL sub-account (distinct from the venue's own
--                               ghl_* fields, which point at the venue's OWN GHL).
--                               Stored so re-syncs update the same contact.
--   owner_listing_alert_sent_at — set the first time we alert the owner that this
--                               venue's listing went live. Guarantees the SMS +
--                               initial owner-GHL push fire exactly once, no matter
--                               how many times the publish action runs.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS owner_ghl_contact_id        text,
  ADD COLUMN IF NOT EXISTS owner_listing_alert_sent_at timestamptz;

COMMENT ON COLUMN public.venues.owner_ghl_contact_id IS
  'Contact id for this venue inside the platform owner''s GHL sub-account (OWNER_GHL_LOCATION_ID). One-way SaaS→GHL sync target.';
COMMENT ON COLUMN public.venues.owner_listing_alert_sent_at IS
  'When the owner was first alerted (SMS) that this venue''s listing went live. NULL = not yet alerted. Ensures exactly-once alert + initial owner-GHL push.';
