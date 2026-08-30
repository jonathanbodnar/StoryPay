-- Migration 207: Super-admin projects board + Meta ad creatives
--
-- admin_project_stages: ordered Kanban columns for tracking private-client
-- onboarding (new client -> onboarding -> guide build -> A2P -> ads -> done).
-- Seeded with sensible defaults; columns are editable/reorderable later.
--
-- venues gains project_stage_id (which column a client card sits in),
-- project_position (vertical order within the column) and project_notes.
-- All nullable; unstaged private clients render in the first column.
--
-- venue_ad_creatives: generated Meta ad copy + composited creative images so
-- past generations persist and can be re-copied without regenerating.

-- ---------------------------------------------------------------------------
-- Stages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_project_stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  label       text NOT NULL,
  color       text NOT NULL DEFAULT '#6b7280',
  position    int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_project_stages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_project_stages FROM anon, authenticated;
GRANT ALL ON public.admin_project_stages TO service_role;
DROP POLICY IF EXISTS "deny_direct_access" ON public.admin_project_stages;
CREATE POLICY "deny_direct_access" ON public.admin_project_stages
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

INSERT INTO public.admin_project_stages (key, label, color, position) VALUES
  ('new_client',  'New Client',       '#6366f1', 0),
  ('onboarding',  'Onboarding',       '#0ea5e9', 1),
  ('guide_build', 'Guide Build',      '#f59e0b', 2),
  ('a2p',         'A2P Registration', '#a855f7', 3),
  ('ads_live',    'Ads Live',         '#10b981', 4),
  ('complete',    'Complete',         '#22c55e', 5)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Board placement on venues
-- ---------------------------------------------------------------------------
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS project_stage_id uuid
    REFERENCES public.admin_project_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_position int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS project_notes text;

CREATE INDEX IF NOT EXISTS venues_project_stage_id_idx
  ON public.venues (project_stage_id);

-- ---------------------------------------------------------------------------
-- Generated Meta ad creatives
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.venue_ad_creatives (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  variant         int  NOT NULL DEFAULT 1,
  template_key    text,
  image_url       text,
  storage_path    text,
  headline        text,
  bullets         jsonb NOT NULL DEFAULT '[]'::jsonb,
  primary_text    text,
  meta_headline   text,
  description     text,
  destination_url text,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_ad_creatives_venue_id_idx
  ON public.venue_ad_creatives (venue_id);

ALTER TABLE public.venue_ad_creatives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_ad_creatives FROM anon, authenticated;
GRANT ALL ON public.venue_ad_creatives TO service_role;
DROP POLICY IF EXISTS "deny_direct_access" ON public.venue_ad_creatives;
CREATE POLICY "deny_direct_access" ON public.venue_ad_creatives
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);
