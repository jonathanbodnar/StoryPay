-- Migration 189 — fix all findings from the Supabase Security Advisor scan
-- (brxnhsaakmhgwcthcapd, 2026-08-04): 13 errors ("RLS Disabled in Public"),
-- plus the highest-value warnings (mutable search_path, anon/authenticated
-- SECURITY DEFINER execute grants, and two "always true" RLS policies).
--
-- Every table/function below was verified against the app code before being
-- touched: every real access path uses supabaseAdmin (service_role), which
-- bypasses RLS and is unaffected by anything here. Realtime in this app is
-- Broadcast-only (src/lib/realtime/channels.ts) — never postgres_changes — so
-- none of it depends on anon/authenticated table grants either.
--
-- Idempotent — safe to re-run.

-- ============================================================================
-- 1) RLS Disabled in Public (13 errors) — same pattern as migration 168.
--    All backend-only tables (CRM messaging, support inbox, billing/plan
--    config, venue product/coupon config). No anon or authenticated
--    consumer found anywhere in StoryPay, homepage/, or weddingdirectory/.
-- ============================================================================
DO $$
DECLARE
  tbl text;
  targets text[] := ARRAY[
    'conversation_thread_reads','venue_products','directory_feature_definitions',
    'directory_plans','platform_billing_events','venue_package_lines',
    'venue_packages','venue_coupons','conversation_threads','conversation_messages',
    'support_team_members','support_thread_messages','support_threads'
  ];
BEGIN
  FOREACH tbl IN ARRAY targets LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format(
        'CREATE POLICY "deny_direct_access" ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false)',
        tbl
      );
    END IF;
  END LOOP;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- policy already exists from a prior partial run
END $$;

-- ============================================================================
-- 2) profiles — "RLS Policy Always True" + a real privilege-escalation path.
--
--    profiles.role drives is_admin() (SELECT ... WHERE role='admin'). The
--    existing "Users can update own profile" policy has USING(auth.uid()=id)
--    with NO check restricting which columns change — so any authenticated
--    user could UPDATE their own row's `role` to 'admin' and pass is_admin()
--    everywhere. The INSERT policy ("Service role can insert profiles") has
--    WITH CHECK(true) with no TO clause, so despite its name it's wide open
--    to anon/authenticated too.
--
--    Every real profiles access in the app (signup, reads, updates, deletes)
--    goes through supabaseAdmin — confirmed across every route that touches
--    'profiles'. These three policies are 100% unused by the current app and
--    only exist as an escalation path, so they're dropped outright rather
--    than patched column-by-column.
-- ============================================================================
DROP POLICY IF EXISTS "Users can read own profile"        ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile"      ON public.profiles;
DROP POLICY IF EXISTS "Service role can insert profiles"  ON public.profiles;

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY "deny_direct_access" ON public.profiles AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false)';
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3) leads — "RLS Policy Always True".
--
--    "Anyone can submit a lead" is WITH CHECK(true), no TO clause: any
--    session (anon or authenticated) can INSERT an arbitrary row directly —
--    any venue_id, any field — completely bypassing the app's HMAC-signature
--    requirement on /api/public/leads. Every real lead-ingestion path in the
--    app (StoryPay's own routes + the weddingdirectory proxy) uses
--    supabaseAdmin, so this policy has no legitimate purpose. Dropped by
--    exact name only — the owner/admin read+update policies (scoped to
--    auth.uid() / is_admin()) are left untouched since they're legacy-safe,
--    not "always true", and not the flagged issue.
-- ============================================================================
DROP POLICY IF EXISTS "Anyone can submit a lead" ON public.leads;

-- ============================================================================
-- 4) Function Search Path Mutable (9 warnings) — pin search_path so these
--    trigger/helper functions can't be hijacked by a malicious schema
--    earlier in a caller's search_path. Purely defensive; does not change
--    grants or behavior.
-- ============================================================================
DO $$
DECLARE
  fn record;
  target_names text[] := ARRAY[
    'ai_concierge_touch_lead_message_timestamps','conversation_reopen_on_inbound',
    'conversation_threads_with_meta','conversation_touch_thread_on_message',
    'marketing_forms_embed_token_immutable','set_updated_at',
    'support_canned_replies_touch_updated_at','support_threads_touch_on_message',
    'trigger_links_short_code_immutable'
  ];
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(target_names)
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public;', fn.sig);
  END LOOP;
END $$;

-- ============================================================================
-- 5) SECURITY DEFINER functions callable by anon/authenticated (warnings).
--    Announcements + waitlist CRUD are called exclusively via supabaseAdmin
--    in StoryPay (confirmed: /api/announcements, /api/admin/announcements/*).
--    insert_waitlist / count_waitlist have zero call sites anywhere in
--    StoryPay, homepage/, or weddingdirectory/ — dead RPCs, safe to lock.
--    rls_auto_enable() has no app call site either.
--    is_admin() is deliberately EXCLUDED — RLS policies evaluate it for
--    anon/authenticated, and it safely returns false for non-admins.
-- ============================================================================
DO $$
DECLARE
  fn record;
  target_names text[] := ARRAY[
    'delete_announcement','get_active_announcements','get_announcements',
    'insert_announcement','update_announcement',
    'insert_waitlist','count_waitlist',
    'rls_auto_enable'
  ];
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(target_names)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated;', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', fn.sig);
  END LOOP;
END $$;

-- funnel_track: exists on this backend project but has zero call sites in
-- StoryPay. Its real, active usage is in weddingdirectory (the separate
-- frontend project's own database), so it's dead code here — lock it down
-- the same way, but tolerate it not existing.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'funnel_track'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated;', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', fn.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- NOT handled here — dashboard-only setting, no SQL equivalent:
--   Authentication -> Sign In / Providers -> Password -> "Leaked password
--   protection" (currently OFF on this project per the advisor). Toggle it
--   on directly; it's a one-click switch, not a migration.
-- ============================================================================
