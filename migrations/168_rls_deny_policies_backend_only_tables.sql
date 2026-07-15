-- Migration 168: Explicit deny policies for backend-only tables
--
-- All data access in StoryVenue goes through the Next.js server using the
-- service_role (admin) key, which bypasses RLS entirely. The tables below
-- should never be queried directly by anonymous or authenticated browser
-- clients via Supabase's REST/realtime APIs.
--
-- RLS is already ENABLED on these tables — the problem is that Supabase
-- flags "RLS enabled but no policies" as a lint warning, which triggers
-- the security alert emails. Adding explicit DENY policies for the two
-- public roles (anon, authenticated) makes the intent crystal clear and
-- silences the recurring advisor warnings without changing any runtime
-- behavior (service_role still has unrestricted server-side access).

-- calendar_events
CREATE POLICY "deny_direct_access" ON public.calendar_events
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- couple_profiles
CREATE POLICY "deny_direct_access" ON public.couple_profiles
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- couple_saved_venues
CREATE POLICY "deny_direct_access" ON public.couple_saved_venues
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- customer_activity
CREATE POLICY "deny_direct_access" ON public.customer_activity
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- customer_files
CREATE POLICY "deny_direct_access" ON public.customer_files
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- customer_notes
CREATE POLICY "deny_direct_access" ON public.customer_notes
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- customer_tasks
CREATE POLICY "deny_direct_access" ON public.customer_tasks
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- listing_reviews
CREATE POLICY "deny_direct_access" ON public.listing_reviews
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- venue_availability
CREATE POLICY "deny_direct_access" ON public.venue_availability
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- venue_calendar_notifications
CREATE POLICY "deny_direct_access" ON public.venue_calendar_notifications
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- venue_calendar_settings
CREATE POLICY "deny_direct_access" ON public.venue_calendar_settings
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- venue_conflict_calendars
CREATE POLICY "deny_direct_access" ON public.venue_conflict_calendars
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- venue_customers
CREATE POLICY "deny_direct_access" ON public.venue_customers
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- venue_date_overrides
CREATE POLICY "deny_direct_access" ON public.venue_date_overrides
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- venue_media_assets
CREATE POLICY "deny_direct_access" ON public.venue_media_assets
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- venue_spaces
CREATE POLICY "deny_direct_access" ON public.venue_spaces
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);
