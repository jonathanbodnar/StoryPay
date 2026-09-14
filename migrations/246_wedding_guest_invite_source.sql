-- ============================================================================
-- 246_wedding_guest_invite_source.sql
--
-- Connects the couple "Invite guests to your website" email flow to the Guest
-- list RSVP tracking. When the couple sends a website invite (guest list + any
-- pasted/CSV addresses), every recipient is auto-added to wedding_guests as
-- "Invited · Awaiting response" and flips to Attending/Declined when they RSVP.
--
--   invited_at    already added in 223 — re-asserted here idempotently (no-op).
--                 Set the first time a guest is invited; preserved thereafter.
--   invite_source distinguishes auto-created website invitees from guests the
--                 couple typed in by hand. NULL on all existing rows (tolerant
--                 readers treat NULL as "manually added / unknown").
--
-- Fully additive + idempotent. `ADD COLUMN IF NOT EXISTS` with no default/NOT
-- NULL is an instant, no-rewrite change in Postgres 11+; existing rows are
-- untouched and simply read back NULL. Ends with a PostgREST schema reload so
-- the API sees the column immediately. Zero risk to existing guest data.
-- ============================================================================

ALTER TABLE public.wedding_guests
  ADD COLUMN IF NOT EXISTS invited_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invite_source TEXT;

COMMENT ON COLUMN public.wedding_guests.invite_source IS
  'How this guest first entered the list: ''website_invite'' for auto-added recipients of the couple website-invite email, NULL for manually-added guests.';

-- Let PostgREST / the API pick up the new column right away.
NOTIFY pgrst, 'reload schema';
