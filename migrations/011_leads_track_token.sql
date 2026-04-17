-- =============================================================================
-- 011_leads_track_token.sql
--
-- Each lead gets an unguessable track_token (32 hex, no dashes). Trigger link
-- URLs can use ?t=<token> instead of ?l=<uuid> for automatic attribution.
-- =============================================================================

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS track_token text;

UPDATE public.leads
SET track_token = lower(replace(gen_random_uuid()::text, '-', ''))
WHERE track_token IS NULL;

ALTER TABLE public.leads
  ALTER COLUMN track_token SET DEFAULT (lower(replace(gen_random_uuid()::text, '-', '')));

ALTER TABLE public.leads ALTER COLUMN track_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS leads_track_token_uidx ON public.leads (track_token);

NOTIFY pgrst, 'reload schema';
