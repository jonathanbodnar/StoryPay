-- 052_fix_toggle_feature_vote.sql
-- Fixes a race condition in toggle_feature_vote where two simultaneous calls
-- could both pass the v_exists check, have the second INSERT silently skipped
-- by ON CONFLICT DO NOTHING, yet still both run the UPDATE vote_count + 1 —
-- causing the count to jump by 2 while only 1 vote row is stored.
--
-- Fix: use GET DIAGNOSTICS after the INSERT to detect whether a row was
-- actually written, and only increment vote_count when it was.

CREATE OR REPLACE FUNCTION public.toggle_feature_vote(
  p_request_id uuid,
  p_venue_id   uuid
)
RETURNS TABLE(voted boolean, vote_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_exists  boolean;
  v_count   integer;
  v_inserted integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM feature_request_votes
    WHERE request_id = p_request_id AND venue_id = p_venue_id
  ) INTO v_exists;

  IF v_exists THEN
    -- Remove vote and decrement counter.
    DELETE FROM feature_request_votes
    WHERE request_id = p_request_id AND venue_id = p_venue_id;

    UPDATE feature_requests
    SET vote_count = GREATEST(0, vote_count - 1)
    WHERE id = p_request_id
    RETURNING vote_count INTO v_count;

    RETURN QUERY SELECT false, v_count;
  ELSE
    -- Attempt insert; ON CONFLICT DO NOTHING protects against a rare race.
    INSERT INTO feature_request_votes (request_id, venue_id)
    VALUES (p_request_id, p_venue_id)
    ON CONFLICT DO NOTHING;

    -- Only increment the counter when the row was actually inserted.
    -- If ON CONFLICT fired (race), v_inserted = 0 and we skip the UPDATE.
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_inserted > 0 THEN
      UPDATE feature_requests
      SET vote_count = vote_count + 1
      WHERE id = p_request_id
      RETURNING vote_count INTO v_count;
    ELSE
      -- Race: vote already existed; just return current count.
      SELECT vote_count FROM feature_requests
      WHERE id = p_request_id
      INTO v_count;
    END IF;

    RETURN QUERY SELECT true, v_count;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
