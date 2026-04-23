-- 054_feature_requests_category.sql
-- Add a category field to feature_requests so venue owners can classify
-- their submissions as a Feature Request, Bug Report, Improvement, or Other.

-- 1. Add the category column (idempotent).
ALTER TABLE public.feature_requests
  ADD COLUMN IF NOT EXISTS category text
    NOT NULL DEFAULT 'feature_request'
    CHECK (category IN ('feature_request', 'bug_report', 'improvement', 'other'));

-- 2. Replace get_feature_requests to include the new category column.
--    Drop by argument signature so we handle any prior RETURNS TABLE mismatch.
DROP FUNCTION IF EXISTS public.get_feature_requests(uuid);

CREATE FUNCTION public.get_feature_requests(p_venue_id uuid)
RETURNS TABLE(
  id           uuid,
  title        text,
  description  text,
  vote_count   integer,
  status       text,
  created_at   timestamptz,
  completed_at timestamptz,
  changelog_id uuid,
  category     text,
  has_voted    boolean,
  is_mine      boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    fr.id,
    fr.title,
    fr.description,
    fr.vote_count,
    fr.status,
    fr.created_at,
    fr.completed_at,
    fr.changelog_id,
    fr.category,
    EXISTS (
      SELECT 1 FROM feature_request_votes frv
      WHERE frv.request_id = fr.id AND frv.venue_id = p_venue_id
    ) AS has_voted,
    (fr.venue_id = p_venue_id) AS is_mine
  FROM feature_requests fr
  ORDER BY fr.vote_count DESC, fr.created_at DESC;
END;
$$;

-- 3. Replace submit_feature_request to accept an optional category param.
--    Drop old 3-arg version first, then recreate with 4 args.
DROP FUNCTION IF EXISTS public.submit_feature_request(uuid, text, text);

CREATE FUNCTION public.submit_feature_request(
  p_venue_id    uuid,
  p_title       text,
  p_description text    DEFAULT NULL,
  p_category    text    DEFAULT 'feature_request'
)
RETURNS SETOF feature_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO feature_requests
    (venue_id, title, description, category, status, vote_count)
  VALUES
    (p_venue_id, p_title, p_description, p_category, 'open', 0)
  RETURNING *;
END;
$$;

NOTIFY pgrst, 'reload schema';
