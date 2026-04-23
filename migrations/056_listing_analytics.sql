-- Listing analytics: tracks every meaningful visitor interaction on public venue listing pages.
-- event_type values: page_view, scroll_25, scroll_50, scroll_75, scroll_100,
--   photo_view, faq_open, map_click, social_click, contact_form_open, contact_form_submit

BEGIN;

CREATE TABLE IF NOT EXISTS public.listing_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  session_id    text        NOT NULL,                  -- anonymous, per-browser-tab session
  event_type    text        NOT NULL,
  event_data    jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- photo_index, faq_index, platform, etc.
  referrer      text,                                  -- document.referrer
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  device_type   text,                                  -- 'mobile' | 'tablet' | 'desktop'
  country       text,                                  -- from request headers (Cloudflare / Vercel)
  region        text,
  city          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Core query pattern: fetch events for a venue in a date range
CREATE INDEX IF NOT EXISTS listing_events_venue_date_idx
  ON public.listing_events (venue_id, created_at DESC);

-- Event-type breakdown per venue
CREATE INDEX IF NOT EXISTS listing_events_venue_type_idx
  ON public.listing_events (venue_id, event_type);

-- Session-level deduplication (unique visitors)
CREATE INDEX IF NOT EXISTS listing_events_session_idx
  ON public.listing_events (session_id, venue_id);

-- Global time-based pruning / admin queries
CREATE INDEX IF NOT EXISTS listing_events_created_at_idx
  ON public.listing_events (created_at DESC);

COMMIT;

NOTIFY pgrst, 'reload schema';
