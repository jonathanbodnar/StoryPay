-- 204: Owner "trial started" SMS alert tracking
--
-- Context: the owner used to get texted every time ANY venue published its
-- listing (onNewListingLive), regardless of whether the venue ever added a
-- card. That's too noisy — the owner only cares once a venue actually starts
-- a paid trial (card on file, subscription created, not yet an active paid
-- charge — i.e. GHL stage "Trial Started", see src/lib/owner-ghl-sync.ts).
--
-- owner_trial_alert_sent_at — stamped the first time this venue's owner-GHL
-- opportunity is synced into the "Trial Started" stage, so the SMS fires
-- exactly once per venue (never re-fires on later syncs/renewals).

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS owner_trial_alert_sent_at timestamptz;

COMMENT ON COLUMN public.venues.owner_trial_alert_sent_at IS
  'Timestamp the platform owner was texted that this venue started a paid trial (GHL stage "Trial Started"). Set once so the alert never re-fires for the same venue.';
