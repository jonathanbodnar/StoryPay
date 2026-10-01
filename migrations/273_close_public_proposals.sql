-- Migration 273: close public access to proposals and invoices.
--
-- Why: two leftover row rules on proposals ("Public read proposals by token"
-- and "Public update proposals for signing", both USING public_token IS NOT
-- NULL, which is every row) plus Supabase's default anon/authenticated table
-- grants let anyone holding the anon key read every proposal and change any
-- column through the REST API. The anon key ships in the browser for couple
-- sign-in, so that was everyone.
--
-- Every proposal page, signature, payment and invoice flow goes through the
-- server with the service role, which bypasses RLS, so nothing in the app
-- used this access. The other proposal tables already had no open rules; their
-- grants are revoked here too so they can't be opened by accident later.
--
-- Also: anon could execute mcp_readonly_refresh_grants (it fails as anon, but
-- only the server should call it).
--
-- Safety: no effect on the server. Idempotent.

DROP POLICY IF EXISTS "Public read proposals by token" ON public.proposals;
DROP POLICY IF EXISTS "Public update proposals for signing" ON public.proposals;

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['proposals','proposal_payments','proposal_installments','proposal_payment_reminders','proposal_templates','proposal_template_fields'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'deny_direct_access') THEN
      EXECUTE format('CREATE POLICY deny_direct_access ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
    END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.mcp_readonly_refresh_grants(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_readonly_refresh_grants(boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
