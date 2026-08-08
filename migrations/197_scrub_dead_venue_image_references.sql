-- 197_scrub_dead_venue_image_references.sql
--
-- Some venue cover/gallery/logo URLs pointed at storage objects that had been
-- deleted (HTTP 404 / NoSuchKey), producing broken <img> tags on public listing
-- pages (e.g. All Saints Memorial Hall, Toledo Barn, Casablanca). This scrubs
-- references whose file no longer exists, computed directly against
-- storage.objects so only genuinely-missing files are removed.
--
-- Prevention already lives in the venue-media DELETE route (it scrubs
-- cover/gallery references on delete); this heals historical rows.
--
-- Idempotent: safe to run more than once. Rows with all-valid images are
-- untouched.
--
-- NOTE: Our Supabase MCP is read-only, so apply this via the Supabase
-- Dashboard SQL Editor (full privileges) or the guarded admin endpoint
-- POST /api/admin/cleanup-dead-venue-images.

-- 1) Gallery: keep non-venue-images URLs and any whose object still exists.
UPDATE venues v
SET gallery_images = COALESCE((
  SELECT jsonb_agg(u.url ORDER BY u.ord)
  FROM jsonb_array_elements_text(v.gallery_images) WITH ORDINALITY AS u(url, ord)
  WHERE u.url NOT LIKE '%/venue-images/%'
     OR EXISTS (SELECT 1 FROM storage.objects o
                WHERE o.bucket_id = 'venue-images'
                  AND o.name = split_part(u.url, '/venue-images/', 2))
), '[]'::jsonb)
WHERE v.gallery_images IS NOT NULL
  AND jsonb_typeof(v.gallery_images) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v.gallery_images) AS u(url)
    WHERE u.url LIKE '%/venue-images/%'
      AND NOT EXISTS (SELECT 1 FROM storage.objects o
                      WHERE o.bucket_id = 'venue-images'
                        AND o.name = split_part(u.url, '/venue-images/', 2))
  );

-- 2) Cover: if dead, reset to the first surviving gallery photo (or NULL).
UPDATE venues v
SET cover_image_url = (
  SELECT u.url
  FROM jsonb_array_elements_text(v.gallery_images) WITH ORDINALITY AS u(url, ord)
  WHERE u.url NOT LIKE '%/venue-images/%'
     OR EXISTS (SELECT 1 FROM storage.objects o
                WHERE o.bucket_id = 'venue-images'
                  AND o.name = split_part(u.url, '/venue-images/', 2))
  ORDER BY u.ord
  LIMIT 1
)
WHERE v.cover_image_url LIKE '%/venue-images/%'
  AND NOT EXISTS (SELECT 1 FROM storage.objects o
                  WHERE o.bucket_id = 'venue-images'
                    AND o.name = split_part(v.cover_image_url, '/venue-images/', 2));

-- 3) Brand logo: clear if dead.
UPDATE venues v
SET brand_logo_url = NULL
WHERE v.brand_logo_url LIKE '%/venue-images/%'
  AND NOT EXISTS (SELECT 1 FROM storage.objects o
                  WHERE o.bucket_id = 'venue-images'
                    AND o.name = split_part(v.brand_logo_url, '/venue-images/', 2));
