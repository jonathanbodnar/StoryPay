-- Per-venue Meta (Facebook) Conversions API credentials.
-- Server-to-server only: no client-side pixel/script anywhere. When a venue
-- has both columns set, a `Lead` event is sent to Meta's Conversions API
-- whenever a bride submits the public listing lead-capture form.
alter table public.venues
  add column if not exists meta_pixel_id text,
  add column if not exists meta_capi_access_token text;

NOTIFY pgrst, 'reload schema';
