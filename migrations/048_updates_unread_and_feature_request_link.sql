-- 048_updates_unread_and_feature_request_link.sql
-- What's New unread tracking + traceable link from changelog entries to the
-- feature request they approved, plus a one-off cleanup of entries posted
-- from April 3, 2026 onward.

-- 1) Track when each venue last viewed the What's New page. The sidebar uses
--    this to render a red dot + unread count until the venue opens Updates.
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS updates_last_seen_at timestamptz;

-- 2) Optional back-link from a changelog entry to the feature request it
--    shipped. Keeps an audit trail but survives the request row being deleted.
ALTER TABLE public.changelog_entries
  ADD COLUMN IF NOT EXISTS feature_request_id uuid
    REFERENCES public.feature_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS changelog_entries_feature_request_id_idx
  ON public.changelog_entries (feature_request_id);

-- 3) One-off: remove What's New updates released on/after April 3, 2026.
--    These were internal test entries the operator asked us to clear.
DELETE FROM public.changelog_entries
  WHERE released_at >= '2026-04-03'::date;

NOTIFY pgrst, 'reload schema';
