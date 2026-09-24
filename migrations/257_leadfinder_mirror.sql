-- Migration 257: LeadFinder™ email mirror.
--
-- Why: LeadFinder reads a venue's inbox on their behalf, which risks feeling like
-- a black box — mail is turned into a lead (or quietly not) with no record in the
-- venue's OWN inbox. The mirror sends the venue a faithful copy of every arrival
-- plus a short banner saying what LeadFinder did with it, so nothing is captured
-- silently.
--
-- Safety: purely additive, expand-only. Nothing is renamed, dropped or
-- repurposed, and every old row reads correctly through the DEFAULT below.
--
--   venues.leadfinder_mirror_enabled  boolean NOT NULL DEFAULT true
--     DEFAULT TRUE is deliberate and matches the product decision: mirroring is
--     ON for every venue, including every venue that already exists. A constant
--     DEFAULT means Postgres 11+ applies it without a table rewrite, so this is
--     instant. The venue can still switch it off from Settings → Integrations.
--
--   leadfinder_imports.mirrored_at / mirror_error
--     `mirrored_at` is the idempotency guard: the mirror claims a row with a
--     conditional UPDATE (... WHERE mirrored_at IS NULL), so an arrival can never
--     be mirrored twice even under concurrent webhook deliveries. `mirror_error`
--     records a best-effort send failure WITHOUT clearing mirrored_at — a mirror
--     that failed is never retried automatically, because a duplicate copy in the
--     owner's inbox is worse than a missing one, and a mirror failure must never
--     undo or block the lead that was already created.
--
-- Idempotent: re-running is a no-op.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS leadfinder_mirror_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.leadfinder_imports
  ADD COLUMN IF NOT EXISTS mirrored_at  timestamptz,
  ADD COLUMN IF NOT EXISTS mirror_error text;

COMMENT ON COLUMN public.venues.leadfinder_mirror_enabled IS
  'Whether LeadFinder emails the venue a copy of each arrival (with a banner describing the outcome) to venue.notification_email || venue.email. Default true; the venue toggles it in Settings → Integrations.';

COMMENT ON COLUMN public.leadfinder_imports.mirrored_at IS
  'When the arrival was mirrored to the venue inbox. Also the idempotency guard: only a row with mirrored_at IS NULL can be claimed, so an arrival is never mirrored twice.';

COMMENT ON COLUMN public.leadfinder_imports.mirror_error IS
  'Best-effort mirror send failure. Never blocks or rolls back lead creation, and never clears mirrored_at (no automatic retry — a duplicate copy is worse than a missing one).';

-- Tell PostgREST to reload its schema cache.
NOTIFY pgrst, 'reload schema';
