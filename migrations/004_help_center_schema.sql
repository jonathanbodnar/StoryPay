-- ============================================================================
-- 004_help_center_schema.sql
--
-- Brings the live Supabase project (brnxhsaakmhgwcthcapd) up to date with the
-- Help Center backend (semantic search + article ratings + search analytics).
--
-- Safe to re-run. All objects use IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================================

-- 1. pgvector extension (for semantic search embeddings) -----------------------
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- 2. help_article_embeddings ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.help_article_embeddings (
  article_id text        PRIMARY KEY,
  embedding  vector(1536) NOT NULL,
  updated_at timestamptz  NOT NULL DEFAULT now()
);

-- HNSW index for fast cosine similarity lookups
CREATE INDEX IF NOT EXISTS help_embeddings_hnsw
  ON public.help_article_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 3. help_search_logs (analytics) ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.help_search_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  search_term  text        NOT NULL,
  result_count integer     NOT NULL DEFAULT 0,
  venue_id     uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS help_search_logs_created_at_idx
  ON public.help_search_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS help_search_logs_term_idx
  ON public.help_search_logs (search_term);

-- 4. article_ratings (thumbs up/down on help articles) ------------------------
CREATE TABLE IF NOT EXISTS public.article_ratings (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id text        NOT NULL,
  rating     text        NOT NULL CHECK (rating IN ('up','down')),
  venue_id   uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS article_ratings_article_id_idx
  ON public.article_ratings (article_id);
CREATE INDEX IF NOT EXISTS article_ratings_created_at_idx
  ON public.article_ratings (created_at DESC);

-- 5. upsert_help_embedding(...) RPC --------------------------------------------
-- SECURITY DEFINER so the route works even if PostgREST's schema cache is cold.
CREATE OR REPLACE FUNCTION public.upsert_help_embedding(
  p_article_id text,
  p_embedding  vector,
  p_updated_at timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.help_article_embeddings (article_id, embedding, updated_at)
  VALUES (p_article_id, p_embedding, p_updated_at)
  ON CONFLICT (article_id)
  DO UPDATE SET embedding = EXCLUDED.embedding, updated_at = EXCLUDED.updated_at;
END;
$$;

-- 6. match_help_articles(...) RPC (cosine similarity search) -------------------
CREATE OR REPLACE FUNCTION public.match_help_articles(
  query_embedding vector,
  match_count     integer DEFAULT 5,
  match_threshold double precision DEFAULT 0.3
)
RETURNS TABLE(article_id text, similarity double precision)
LANGUAGE sql
STABLE
AS $$
  SELECT
    h.article_id,
    1 - (h.embedding <=> query_embedding) AS similarity
  FROM public.help_article_embeddings h
  WHERE 1 - (h.embedding <=> query_embedding) >= match_threshold
  ORDER BY h.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 7. Grants --------------------------------------------------------------------
-- service_role already has full access via default grants in Supabase, but
-- we pin these explicitly so the anon/authenticated roles can run the search
-- RPC (read-only) while writes still route through supabaseAdmin.
GRANT EXECUTE ON FUNCTION public.match_help_articles(vector, integer, double precision)
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.upsert_help_embedding(text, vector, timestamptz)
  TO service_role;
