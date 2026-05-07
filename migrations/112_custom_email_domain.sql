-- 112_custom_email_domain.sql
-- ============================================================================
-- Per-venue custom sending domain support.
--
-- Venues can connect their own domain (e.g. rollingsmeadows.com) so that
-- marketing emails send from hello@rollingsmeadows.com instead of the
-- shared hello@send.storyvenue.com. Resend's Domains API provisions the
-- domain and returns DNS records the venue must add; we store those here
-- so we never need to re-fetch them on every settings page load.
--
-- Status values:
--   not_configured  — no domain set
--   pending         — domain created in Resend, awaiting DNS verification
--   verified        — DKIM + SPF confirmed; emails will send from this domain
--   failed          — verification failed / domain removed from Resend
--
-- Idempotent. Safe to re-run.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS custom_email_domain       text,
  ADD COLUMN IF NOT EXISTS resend_domain_id          text,
  ADD COLUMN IF NOT EXISTS custom_from_email         text,
  ADD COLUMN IF NOT EXISTS custom_from_name          text,
  ADD COLUMN IF NOT EXISTS custom_domain_status      text NOT NULL DEFAULT 'not_configured',
  ADD COLUMN IF NOT EXISTS custom_domain_dns_records jsonb,
  ADD COLUMN IF NOT EXISTS custom_domain_verified_at timestamptz;

-- Enforce valid status values
ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS venues_custom_domain_status_check;

ALTER TABLE public.venues
  ADD CONSTRAINT venues_custom_domain_status_check
  CHECK (custom_domain_status IN ('not_configured', 'pending', 'verified', 'failed'));

-- Quick look-up by Resend domain ID (used by potential future webhooks)
CREATE INDEX IF NOT EXISTS venues_resend_domain_id_idx
  ON public.venues (resend_domain_id)
  WHERE resend_domain_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
