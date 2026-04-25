-- =============================================================================
-- 061_marketing_segments.sql
--
-- Saved audience segments. Venues can build a segment once (using the same
-- filters available on a campaign — tags, pipeline stages, exclude stages,
-- wedding-date required, trigger-link clicks, exclude booked stages) and
-- reuse it across as many campaigns as they want. Editing a saved segment
-- updates the audience for every campaign that references it on the next
-- send (drafts and scheduled campaigns re-resolve at send time).
--
-- The `definition_json` column holds the same shape as `marketing_campaigns.
-- segment_json` (CampaignSegment in src/lib/marketing-email-schema.ts) — but
-- with `type` constrained to `all_leads`, `tags_any`, or `stages` (the
-- "saved_segment" indirection only ever lives on a campaign, not on a saved
-- segment itself, to prevent cycles).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.marketing_segments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text        NOT NULL DEFAULT '',
  definition_json jsonb       NOT NULL DEFAULT '{"type":"all_leads"}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_segments_name_len CHECK (char_length(name) >= 1 AND char_length(name) <= 200),
  CONSTRAINT marketing_segments_desc_len CHECK (char_length(description) <= 500)
);

CREATE INDEX IF NOT EXISTS marketing_segments_venue_id_idx ON public.marketing_segments (venue_id);
CREATE INDEX IF NOT EXISTS marketing_segments_venue_updated_idx ON public.marketing_segments (venue_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS marketing_segments_venue_name_uidx
  ON public.marketing_segments (venue_id, lower(name));

DROP TRIGGER IF EXISTS trg_marketing_segments_updated_at ON public.marketing_segments;
CREATE TRIGGER trg_marketing_segments_updated_at
  BEFORE UPDATE ON public.marketing_segments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.marketing_segments IS
  'Reusable audience segments. Referenced from marketing_campaigns.segment_json when type = "saved_segment".';
COMMENT ON COLUMN public.marketing_segments.definition_json IS
  'CampaignSegment-shaped JSON. type must be one of all_leads | tags_any | stages (saved segments cannot reference other saved segments).';

COMMIT;
