-- Migration 208: rename the project board stages + add timestamped notes.
--
-- 1. Rebrand the six seeded stages in place (by position) so existing card
--    placements (which reference stage UUIDs) are preserved:
--      Kickoff Call · A2P Submitted · A2P Approved · Training · Ads Ready · Live
-- 2. admin_project_notes: append-only, timestamped/authored notes per venue,
--    replacing the single free-text venues.project_notes field.

-- ---------------------------------------------------------------------------
-- Rename stages in place (position-keyed, so UUIDs / card links are kept)
-- ---------------------------------------------------------------------------
UPDATE public.admin_project_stages AS s
SET key = v.key, label = v.label, color = v.color
FROM (VALUES
  (0, 'kickoff_call',  'Kickoff Call',  '#6366f1'),
  (1, 'a2p_submitted', 'A2P Submitted', '#0ea5e9'),
  (2, 'a2p_approved',  'A2P Approved',  '#a855f7'),
  (3, 'training',      'Training',      '#f59e0b'),
  (4, 'ads_ready',     'Ads Ready',     '#14b8a6'),
  (5, 'live',          'Live',          '#22c55e')
) AS v(position, key, label, color)
WHERE s.position = v.position;

-- Fallback seed in case the board was never seeded (fresh env).
INSERT INTO public.admin_project_stages (key, label, color, position) VALUES
  ('kickoff_call',  'Kickoff Call',  '#6366f1', 0),
  ('a2p_submitted', 'A2P Submitted', '#0ea5e9', 1),
  ('a2p_approved',  'A2P Approved',  '#a855f7', 2),
  ('training',      'Training',      '#f59e0b', 3),
  ('ads_ready',     'Ads Ready',     '#14b8a6', 4),
  ('live',          'Live',          '#22c55e', 5)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Timestamped project notes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_project_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  body       text NOT NULL,
  author     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_project_notes_venue_idx
  ON public.admin_project_notes (venue_id, created_at DESC);

ALTER TABLE public.admin_project_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_project_notes FROM anon, authenticated;
GRANT ALL ON public.admin_project_notes TO service_role;
DROP POLICY IF EXISTS "deny_direct_access" ON public.admin_project_notes;
CREATE POLICY "deny_direct_access" ON public.admin_project_notes
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- Seed the notes log from any existing single-field notes so nothing is lost.
INSERT INTO public.admin_project_notes (venue_id, body, author, created_at)
SELECT id, project_notes, 'migrated', now()
FROM public.venues
WHERE project_notes IS NOT NULL AND btrim(project_notes) <> '';
