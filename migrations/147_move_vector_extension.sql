-- Migration 147 — move pgvector out of the public schema.
--
-- Supabase linter 0014 flags extensions installed in public. The only dependents
-- are public.help_article_embeddings.embedding and its HNSW index, which reference
-- the type/opclass by OID and survive the schema move. match_help_articles uses the
-- <=> operator at runtime, so its search_path must include the extensions schema.
--
-- Idempotent — the extension move is guarded so re-running is a no-op.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'vector' AND n.nspname = 'public'
  ) THEN
    EXECUTE 'ALTER EXTENSION vector SET SCHEMA extensions';
  END IF;
END $$;

ALTER FUNCTION public.match_help_articles(vector, integer, double precision)
  SET search_path = public, extensions;

ALTER FUNCTION public.upsert_help_embedding(text, vector, timestamptz)
  SET search_path = public, extensions;

NOTIFY pgrst, 'reload schema';
