-- 247_venue_lead_link_slug.sql
--
-- Additive, expand-only migration for the short Lead Link bio URL.
-- Adds `venues.lead_link_slug` — a short, brandable handle that resolves to the
-- venue's Lead Link page at storyvenue.com/<lead_link_slug> (a link-shortener
-- style URL for social bios). Nothing on older deploys reads it, so there is
-- zero risk to existing data. Readers fall back to the directory `slug` when the
-- column is absent/NULL, and we backfill every existing venue from its `slug`
-- so all current Lead Links keep working with no owner action.
--
-- `ADD COLUMN` (nullable, no default) is an instant, no-rewrite change. The
-- backfill is a one-shot UPDATE over a small table (venues). Uniqueness is
-- enforced case-insensitively via a partial unique index (NULLs allowed, so an
-- unclaimed venue never collides). Idempotent (IF [NOT] EXISTS) and ends with a
-- PostgREST schema reload so the API sees the column immediately.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS lead_link_slug text;

-- Backfill from the directory slug: the short link defaults to the venue's
-- existing slug so every published venue already has a working short URL.
-- `slug` is already unique + lowercased (see slugify), so lower(slug) collisions
-- are not expected.
UPDATE public.venues
   SET lead_link_slug = slug
 WHERE lead_link_slug IS NULL
   AND slug IS NOT NULL
   AND slug <> '';

-- Case-insensitive uniqueness. Partial so multiple venues without a handle
-- (NULL) never collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS venues_lead_link_slug_lower_key
  ON public.venues (lower(lead_link_slug))
  WHERE lead_link_slug IS NOT NULL;

-- Let PostgREST / the API pick up the new column right away.
NOTIFY pgrst, 'reload schema';
