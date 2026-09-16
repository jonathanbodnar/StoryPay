-- Venue-owned announcement bar for the public listing page.
--
-- Additive only (expand): a single nullable JSONB column. Existing rows are
-- unaffected (announcement IS NULL → no strip). The reader is tolerant and
-- defaults every field, so old/partial shapes never break rendering.
--
-- Shape: { enabled: boolean, message: text, expires_at: timestamptz|null }
-- Message-only by design (no outbound link/button) so the strip never competes
-- with the pricing-guide lead-capture opt-in on the landing page.
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS announcement jsonb;

NOTIFY pgrst, 'reload schema';
