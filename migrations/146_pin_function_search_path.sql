-- Migration 146 — pin search_path on flagged functions.
--
-- These functions had a role-mutable search_path (Supabase linter 0011), which
-- allows search_path-hijacking. All bodies reference their objects with
-- schema-qualified names (or pg_catalog only), so pinning search_path is
-- behavior-preserving.
--
-- Idempotent — safe to re-run.

ALTER FUNCTION public.handle_new_user()    SET search_path = public;
ALTER FUNCTION public.is_admin()           SET search_path = public;
ALTER FUNCTION public.update_updated_at()  SET search_path = public;
ALTER FUNCTION public.set_updated_at()     SET search_path = public;
