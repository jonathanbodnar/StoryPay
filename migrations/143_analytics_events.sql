-- 143_analytics_events.sql
-- Lightweight product-usage / funnel analytics event stream.
--
-- Records what venues (and their team members) do inside the app: page views,
-- clicks on key UI, and named funnel "milestone" events (signup, guide
-- published, AI enabled, first lead, upgrade). Powers the super-admin
-- "Usage Analytics" tab — top metrics, signup→activation funnel, top pages,
-- top clicked elements, trending features, and a live activity feed.
--
-- Access model: writes happen via the service-role client (supabaseAdmin) from
-- the ingest route + server milestone hooks. Reads happen only through the
-- admin analytics API. RLS is ENABLED with no policies so anon/authenticated
-- can never read platform-wide behavioral data (service role bypasses RLS).

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Event name. For auto-capture: 'pageview' | 'click'. For funnel milestones:
  -- 'signup' | 'guide_published' | 'ai_enabled' | 'first_lead' | 'upgrade' | ...
  event        text        NOT NULL,
  -- Bucket: 'auto' (pageview/click firehose) | 'milestone' (funnel signal).
  kind         text        NOT NULL DEFAULT 'auto',
  -- Sub-account the actor belongs to (nullable for pre-login / anonymous).
  venue_id     uuid        REFERENCES public.venues(id) ON DELETE SET NULL,
  -- Who did it, when known (partial-masked email kept rather than FK).
  user_email   text,
  -- Actor role: owner | admin | member | anon
  role         text,
  -- Page path the event happened on (e.g. /dashboard/leads).
  path         text,
  -- Human label of the thing clicked / the milestone (e.g. "Add Lead").
  label        text,
  -- Client-generated session id, so we can stitch a single visit together.
  session_id   text,
  -- Arbitrary structured context (referrer, element type, ids, etc.).
  properties   jsonb
);

CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx ON public.analytics_events (created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_event_idx      ON public.analytics_events (event);
CREATE INDEX IF NOT EXISTS analytics_events_kind_idx       ON public.analytics_events (kind);
CREATE INDEX IF NOT EXISTS analytics_events_venue_id_idx   ON public.analytics_events (venue_id);
CREATE INDEX IF NOT EXISTS analytics_events_path_idx       ON public.analytics_events (path);
CREATE INDEX IF NOT EXISTS analytics_events_session_idx    ON public.analytics_events (session_id);
-- Fast "has this venue already hit this milestone?" lookups (funnel dedupe).
CREATE INDEX IF NOT EXISTS analytics_events_milestone_idx
  ON public.analytics_events (venue_id, event) WHERE kind = 'milestone';

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
-- No policies: anon/authenticated get zero rows; service role bypasses RLS.

NOTIFY pgrst, 'reload schema';
