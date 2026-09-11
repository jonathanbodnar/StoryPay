-- ============================================================================
-- 230_couple_site_embed_password.sql
--
-- Wedding Website: embeddable element + optional private password gate.
--   * couple_sites.embed_html   — a SANITIZED single <iframe> (livestream,
--     special elements). Sanitisation happens in app code on write; only a
--     rebuilt https iframe is ever stored, so no scripts/handlers persist.
--   * couple_sites.embed_enabled / embed_title — toggle + heading for it.
--   * couple_sites.site_password_hash — scrypt hash. NULL = public (no gate).
--     When set, the public page is locked until a guest enters the password.
--
-- All columns are nullable or defaulted; existing rows are untouched. Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.couple_sites
  ADD COLUMN IF NOT EXISTS embed_html          TEXT,
  ADD COLUMN IF NOT EXISTS embed_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS embed_title         TEXT,
  ADD COLUMN IF NOT EXISTS site_password_hash  TEXT;

NOTIFY pgrst, 'reload schema';

COMMIT;
