-- Migration 253: allow a lead to have no phone number.
--
-- Why: email-sourced leads (StoryVenue LeadFinder, and any future inbox or
-- ad-platform source) frequently arrive with no phone at all — marketplace relay
-- emails usually carry no number, and the venue may not have collected one yet.
-- Today the column is NOT NULL, so such a lead cannot be stored at all.
--
-- Two representations of "no phone" already exist in the wild: NULL and ''.
-- The empty string comes from ingest paths that write `phone || ''`. Normalising
-- to NULL FIRST gives one canonical state, so every null-check downstream (or in
-- a query) only has to think about a single value.
--
-- Order matters: the constraint has to be dropped BEFORE the empty strings can
-- be normalised to NULL, otherwise the UPDATE violates NOT NULL. (Learned the
-- hard way — the first run of this file failed on exactly that.)
--
-- Safety: dropping NOT NULL cannot lose data, and this is expand-phase only —
-- nothing is renamed, dropped, or repurposed. Both statements are idempotent, so
-- re-running this file is a no-op.

-- 1. Relax the constraint. A lead with no phone is a valid state now.
ALTER TABLE public.leads
  ALTER COLUMN phone DROP NOT NULL;

-- 2. Canonicalise the empty string to NULL (idempotent: second run matches 0 rows).
UPDATE public.leads
   SET phone = NULL
 WHERE phone IS NOT NULL
   AND btrim(phone) = '';

NOTIFY pgrst, 'reload schema';
