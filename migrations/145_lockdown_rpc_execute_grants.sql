-- Migration 145 — lock down RPC EXECUTE grants.
--
-- Several SECURITY DEFINER / server-only functions were callable by the anon &
-- authenticated PostgREST roles (i.e. by anyone holding the publishable key)
-- directly via /rest/v1/rpc/<fn>, bypassing the Next.js app's own auth checks.
-- None of them are called from browser/anon-key code — the backend invokes them
-- exclusively through the service-role client — so removing the implicit PUBLIC
-- grant and granting service_role only closes the bypass with no functional impact.
--
-- NOTE: public.is_admin() is deliberately NOT included — it is referenced by RLS
-- policies evaluated for anon/authenticated, so it must remain executable by them.
-- It is safe: it checks auth.uid() internally and returns false for non-admins.
--
-- Idempotent — safe to re-run.

DO $$
DECLARE
  fn record;
  target_names text[] := ARRAY[
    -- orphaned team-member fns (no call sites in app code; superseded by /api/team/*)
    'get_team_members','list_team_members','insert_team_member','update_team_member','delete_team_member','resend_team_invite',
    -- feature-request fns (app calls only via service_role)
    'submit_feature_request','toggle_feature_vote','get_feature_requests','get_feature_request_detail',
    'update_feature_request_status','admin_update_feature_request_status','admin_delete_feature_request',
    'admin_get_feature_request_detail','complete_feature_request_with_changelog','venue_delete_feature_request',
    -- misc server-only fns
    'upsert_help_embedding','get_changelog','handle_new_user'
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

NOTIFY pgrst, 'reload schema';
