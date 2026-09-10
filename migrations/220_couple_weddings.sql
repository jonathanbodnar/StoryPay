-- ============================================================================
-- 220_couple_weddings.sql
--
-- The "bride portal" bridge: links an authenticated couple (couple_profiles /
-- auth.users, role='couple') to a venue's booked-customer record
-- (public.venue_customers). This is the connective tissue that lets a logged-in
-- bride see her wedding and message her venue from inside StoryVenue.
--
-- Linking is bidirectional and venue-approved:
--   * venue invites bride  -> row with initiated_by='venue', status='pending',
--                             claim_token set, couple_id NULL until she claims.
--   * bride requests venue -> row with initiated_by='bride', status='pending',
--                             couple_id set, venue approves to flip to 'linked'.
--
-- Accessed only from the Next.js API using the service role (same pattern as
-- couple_profiles / conversation_threads). RLS disabled; app enforces ownership.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.couple_weddings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id              uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  venue_id               uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  venue_customer_id      uuid REFERENCES public.venue_customers(id) ON DELETE SET NULL,

  status                 text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'linked', 'declined', 'revoked')),
  initiated_by           text NOT NULL CHECK (initiated_by IN ('venue', 'bride')),

  invited_email          text,
  invited_name           text,
  request_message        text,

  claim_token            text,
  claim_token_expires_at timestamptz,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  linked_at              timestamptz,
  decided_at             timestamptz
);

-- Claim tokens are unique when present (venue -> bride invite links).
CREATE UNIQUE INDEX IF NOT EXISTS couple_weddings_claim_token_key
  ON public.couple_weddings (claim_token)
  WHERE claim_token IS NOT NULL;

-- A couple can have at most one active (pending/linked) relationship per venue.
CREATE UNIQUE INDEX IF NOT EXISTS couple_weddings_active_couple_venue
  ON public.couple_weddings (couple_id, venue_id)
  WHERE status IN ('pending', 'linked') AND couple_id IS NOT NULL;

-- A booked customer record can be linked to at most one couple at a time.
CREATE UNIQUE INDEX IF NOT EXISTS couple_weddings_linked_customer
  ON public.couple_weddings (venue_customer_id)
  WHERE status = 'linked' AND venue_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS couple_weddings_couple_idx
  ON public.couple_weddings (couple_id);
CREATE INDEX IF NOT EXISTS couple_weddings_venue_status_idx
  ON public.couple_weddings (venue_id, status);
CREATE INDEX IF NOT EXISTS couple_weddings_invited_email_idx
  ON public.couple_weddings (lower(invited_email));

DROP TRIGGER IF EXISTS trg_couple_weddings_updated_at ON public.couple_weddings;
CREATE TRIGGER trg_couple_weddings_updated_at
  BEFORE UPDATE ON public.couple_weddings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Server uses the service role exclusively (no direct browser PostgREST access),
-- mirroring couple_profiles / conversation_threads.
ALTER TABLE public.couple_weddings DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.couple_weddings TO service_role;

COMMENT ON TABLE public.couple_weddings IS
  'Bride portal bridge: links an authenticated couple to a venue booked-customer record. Service-role access only.';

-- The bride side of a conversation thread uses reader_ref = ''couple:<uuid>'' in
-- conversation_thread_reads. No schema change needed (reader_ref is free text).

NOTIFY pgrst, 'reload schema';

COMMIT;
