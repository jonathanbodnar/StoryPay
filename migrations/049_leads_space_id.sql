-- =============================================================================
-- 049_leads_space_id.sql
-- Adds an optional "primary space" to a lead so venues can capture which
-- space the couple is most interested in straight from the New Lead modal on
-- the Leads page — same picker (and inline add/edit/remove) we already have
-- on the calendar event modal.
--
-- REQUIRED on every Supabase project that runs this app: Dashboard → SQL →
-- paste this file → Run. Without the column, /api/leads POST silently drops
-- the field (we fall back gracefully) so new-lead creation still works.
-- =============================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS space_id uuid
    REFERENCES public.venue_spaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS leads_space_id_idx
  ON public.leads (venue_id, space_id);

COMMENT ON COLUMN public.leads.space_id
  IS 'Primary venue space the couple is interested in; mirrors calendar_events.space_id for booked weddings.';

NOTIFY pgrst, 'reload schema';
