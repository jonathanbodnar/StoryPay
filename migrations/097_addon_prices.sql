-- Migration 097: platform_addon_prices
-- Stores admin-configurable per-addon prices so they can be changed without
-- a code deploy. Prices fall back to the hardcoded constants in directory-addons.ts
-- when this table hasn't been seeded yet.

CREATE TABLE IF NOT EXISTS public.platform_addon_prices (
  key         TEXT         PRIMARY KEY,
  price_cents INTEGER      NOT NULL DEFAULT 0,
  label       TEXT         NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO public.platform_addon_prices (key, price_cents, label) VALUES
  ('verified',  1900,  'Verified Listing'),
  ('sponsored', 9900,  'Sponsored Listing'),
  ('concierge', 49900, 'Venue Concierge')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
