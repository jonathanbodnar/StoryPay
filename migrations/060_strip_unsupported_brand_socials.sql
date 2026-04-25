-- One-time cleanup: strip any social platform from venues.brand_socials that
-- is not in the current supported set. Run after the Threads social network
-- was retired across the platform — any leftover {platform: "threads", ...}
-- entries persisted in existing venue rows must go so they never resurface
-- in the email builder or in a delivered email.
--
-- The supported set is the same one enforced by:
--   - SOCIAL_PLATFORM_DEFS in src/lib/use-brand-socials.ts
--   - the KNOWN set in src/app/api/venues/me/route.ts (PATCH validation)
--   - SUPPORTED_SOCIAL_PLATFORMS in src/lib/marketing-email-injection.ts
--
-- Idempotent: a venue with no brand_socials, no unsupported entries, or no
-- platform key on an entry is left untouched.

BEGIN;

UPDATE public.venues
SET brand_socials = COALESCE(
  (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(brand_socials) AS elem
    WHERE (elem ->> 'platform') IN (
      'facebook', 'instagram', 'youtube', 'tiktok',
      'pinterest', 'linkedin', 'twitter', 'website'
    )
  ),
  '[]'::jsonb
)
WHERE jsonb_typeof(brand_socials) = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(brand_socials) AS elem
    WHERE (elem ->> 'platform') IS NULL
       OR (elem ->> 'platform') NOT IN (
         'facebook', 'instagram', 'youtube', 'tiktok',
         'pinterest', 'linkedin', 'twitter', 'website'
       )
  );

COMMIT;
