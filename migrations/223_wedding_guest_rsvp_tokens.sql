-- ============================================================================
-- 223_wedding_guest_rsvp_tokens.sql
--
-- Guest self-service RSVP + email invitations for the Bride Portal.
--
-- Each guest gets an unguessable rsvp_token that powers a public, no-login RSVP
-- page (/rsvp/<token>). The bride emails guests their personal link; guests
-- respond themselves, which flows straight into the bride + venue rollups.
--
--   rsvp_token         unguessable per-guest handle for the public RSVP page
--   invited_at         when the most recent invite email was sent (null = never)
--   responded_at       when the guest self-submitted their RSVP (null = no reply)
--   invite_sent_count  number of invite emails sent (for "resend" affordance)
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.wedding_guests
  ADD COLUMN IF NOT EXISTS rsvp_token        UUID        NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS invited_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS responded_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invite_sent_count INTEGER     NOT NULL DEFAULT 0;

-- Unguessable + unique. The public RSVP page looks a guest up by this token.
CREATE UNIQUE INDEX IF NOT EXISTS wedding_guests_rsvp_token_key
  ON public.wedding_guests (rsvp_token);

COMMENT ON COLUMN public.wedding_guests.rsvp_token IS
  'Unguessable per-guest token for the public /rsvp/<token> self-service RSVP page.';

NOTIFY pgrst, 'reload schema';

COMMIT;
