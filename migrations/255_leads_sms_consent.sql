-- Migration 255: per-lead permission to send automated texts.
--
-- Why: LeadFinder reads a couple's phone number out of a forwarded directory
-- email. That number was given to the directory, not to us, and it is not
-- consent for an automated text (TCPA). Until now every send path only asked
-- "do we have a number?", so a captured lead with a phone would be swept into
-- the AI Concierge and texted the moment the venue's workflow activated it.
--
-- This column makes "we may text this person" an explicit fact about the lead
-- rather than an assumption inferred from the presence of a phone number.
--
-- DIRECTION OF SAFETY — read this before changing the default:
--   true  = allowed to text. This is the DEFAULT.
--   false = do NOT text until they opt in.
-- Defaulting to true is deliberate and load-bearing: every lead that already
-- exists, and every lead created by the web form, directory or manual entry,
-- keeps exactly today's behaviour. Only the forwarded-email paths opt OUT by
-- writing false. Flipping this default to false would silently mute automated
-- texting for the whole platform — that is a product decision, not a migration.
--
-- Mirrors the existing sms_dnd trio (migration 041) so the audit trail reads the
-- same way: a boolean, when it changed, and what changed it.
--
-- Safety: purely additive. ADD COLUMN with a constant default is instant on
-- Postgres 11+ (no table rewrite), no existing row is touched, and nothing is
-- renamed, dropped or repurposed. Idempotent, so re-running is a no-op.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS sms_consent        boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_consent_at     timestamptz,
  ADD COLUMN IF NOT EXISTS sms_consent_source text;

COMMENT ON COLUMN public.leads.sms_consent IS
  'May we send THIS LEAD an automated text? Defaults true (a number typed into one of our own forms is consent). Forwarded-email sources such as LeadFinder set false until the couple opts in — check this before ANY automated SMS to a lead.';

COMMENT ON COLUMN public.leads.sms_consent_at IS
  'When sms_consent last changed to its current value. NULL for rows that still hold the default.';

COMMENT ON COLUMN public.leads.sms_consent_source IS
  'What granted or revoked consent: form_submit | inbound_reply | inbound_sms | leadfinder_forwarded_email | manual.';

-- Partial index: the only query shape that matters is "find the handful of
-- leads we are not yet allowed to text", which is expected to stay tiny.
CREATE INDEX IF NOT EXISTS leads_sms_consent_false_idx
  ON public.leads (venue_id)
  WHERE sms_consent = false;

NOTIFY pgrst, 'reload schema';
