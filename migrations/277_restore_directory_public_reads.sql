-- 277: Migration 276 closed the public (anon) key's table reads after the
-- Oct 3 audit found venue secrets readable. The audit missed that the
-- storyvenue.com directory site (its own repo, ~/weddingdirectory) reads
-- venues, venue_pricing_guides and directory_plans DIRECTLY with the anon
-- key — 276 emptied every venue list, listing page and Lead Link page there.
--
-- This restores exactly what that repo's own hardening (its db/020–024)
-- designed: row policies for the public reads, with COLUMN-level grants so
-- the anon key can only ever see the columns the directory actually renders.
-- Secrets (password_hash, login_token, ghl/calendly/lunarpay/eventtemple
-- keys…) stay unreadable: the revokes below wipe any wider grant and the
-- grants re-list only the safe columns. tests/flows/locked-database.test.ts
-- holds this exact contract.
--
-- Idempotent — safe to run multiple times.

-- ── venues: published rows only, safe columns only ─────────────────────
drop policy if exists "Public can read published venues" on public.venues;
create policy "Public can read published venues"
  on public.venues for select
  to anon, authenticated
  using (is_published = true);

revoke select on public.venues from anon, authenticated;
grant select (
  id, slug, name, description, venue_type,
  location_full, location_city, location_state, lat, lng,
  capacity_min, capacity_max, price_min, price_max, indoor_outdoor,
  features, cover_image_url, gallery_images, availability_notes,
  is_published, is_demo, demo_preview_token,
  brand_website, phone, email, show_map, social_links, faq,
  google_place_id, google_reviews_cache, google_reviews_fetched_at,
  directory_verified_status, directory_sponsored_status, directory_plan_id,
  meta_pixel_id, seo_title, seo_description, seo_keywords,
  lead_link_links,
  created_at, updated_at
) on public.venues to anon, authenticated;

-- ── venue_pricing_guides: the directory shows the guide cover only ─────
drop policy if exists deny_direct_access on public.venue_pricing_guides;
drop policy if exists "anon_select_venue_pricing_guides" on public.venue_pricing_guides;
create policy "anon_select_venue_pricing_guides"
  on public.venue_pricing_guides for select
  to anon
  using (true);

revoke select on public.venue_pricing_guides from anon, authenticated;
grant select (id, venue_id, cover_image_url, enabled)
  on public.venue_pricing_guides to anon;

-- ── directory_plans: nav flags for a plan looked up by id ──────────────
-- (Row filter stays USING (true): venue pages look plans up strictly by id;
-- gating rows on is_public broke them once before — see the directory
-- repo's db/020 "lesson" note.)
drop policy if exists deny_direct_access on public.directory_plans;
drop policy if exists "anon_select_directory_plans" on public.directory_plans;
create policy "anon_select_directory_plans"
  on public.directory_plans for select
  to anon
  using (true);

revoke select on public.directory_plans from anon, authenticated;
grant select (id, nav_permissions, hide_header)
  on public.directory_plans to anon;

NOTIFY pgrst, 'reload schema';
