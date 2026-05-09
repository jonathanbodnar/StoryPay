-- 124: ESIGN/UETA audit trail on proposal signatures
--
-- Background
-- ----------
-- The /api/proposals/public/[token]/sign endpoint historically captured
-- only the signature image + signed_at. Under ESIGN/UETA (the US federal
-- + state e-signature laws), an enforceable electronic signature also
-- requires the signer's express consent to do business electronically,
-- a record of WHO signed (IP/user-agent), and a tamper-evident snapshot
-- of WHAT they signed (so the venue can't quietly edit the contract
-- after the fact).
--
-- This migration adds:
--   * signer_ip                 — best-effort source IP from x-forwarded-for
--   * signer_user_agent         — User-Agent header string
--   * signer_consent_text       — exact disclosure shown to the signer
--   * signer_consent_accepted   — explicit checkbox state at sign time
--   * signed_content_hash       — SHA-256 of (content || price || customer)
--                                 captured at sign time. If the venue
--                                 changes the proposal afterward, the
--                                 hash will not match and the legal
--                                 record is preserved.
--   * signed_payment_type       — payment_type at sign time
--   * signed_price              — price (cents) at sign time
--
-- All columns are nullable so historical signatures (pre-launch) keep
-- working unchanged. New signatures populate them all.

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS signer_ip               text,
  ADD COLUMN IF NOT EXISTS signer_user_agent       text,
  ADD COLUMN IF NOT EXISTS signer_consent_text     text,
  ADD COLUMN IF NOT EXISTS signer_consent_accepted boolean,
  ADD COLUMN IF NOT EXISTS signed_content_hash     text,
  ADD COLUMN IF NOT EXISTS signed_payment_type     text,
  ADD COLUMN IF NOT EXISTS signed_price            integer;

CREATE INDEX IF NOT EXISTS proposals_signed_content_hash_idx
  ON public.proposals (signed_content_hash)
  WHERE signed_content_hash IS NOT NULL;
