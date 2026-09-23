-- Migration 252: corpus separation for Help Center embeddings.
--
-- The Help Center semantic index is shared infrastructure: venue-owner articles
-- and (new) couple articles both store embeddings in help_article_embeddings.
-- They must never surface in each other's search, so the table gains a `corpus`
-- discriminator and the read/write functions gain a matching parameter.
--
-- Additive by design. The column has a DEFAULT, so existing rows become 'venue'
-- with no table rewrite (Postgres 11+). The ORIGINAL functions are deliberately
-- left in place: changing a function's signature in Postgres creates an
-- OVERLOAD rather than replacing it, which makes existing callers ambiguous, so
-- the new functions get new names instead. Nothing is renamed or dropped.
--
-- Couple article ids are all namespaced `couple-`, and the primary key stays on
-- article_id alone, so no key change is required.

ALTER TABLE public.help_article_embeddings
  ADD COLUMN IF NOT EXISTS corpus text NOT NULL DEFAULT 'venue';

CREATE INDEX IF NOT EXISTS help_embeddings_corpus_idx
  ON public.help_article_embeddings (corpus);

-- Writes: corpus-aware upsert (new name so the original keeps working).
CREATE OR REPLACE FUNCTION public.upsert_help_embedding_v2(
  p_article_id text,
  p_embedding  vector,
  p_corpus     text,
  p_updated_at timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.help_article_embeddings (article_id, embedding, corpus, updated_at)
  VALUES (
    p_article_id,
    p_embedding,
    COALESCE(NULLIF(p_corpus, ''), 'venue'),
    p_updated_at
  )
  ON CONFLICT (article_id)
  DO UPDATE SET embedding  = EXCLUDED.embedding,
                corpus     = EXCLUDED.corpus,
                updated_at = EXCLUDED.updated_at;
END;
$$;

-- Reads: corpus-filtered cosine similarity search.
CREATE OR REPLACE FUNCTION public.match_help_articles_v2(
  query_embedding vector,
  p_corpus        text DEFAULT 'venue',
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
  WHERE h.corpus = COALESCE(NULLIF(p_corpus, ''), 'venue')
    AND 1 - (h.embedding <=> query_embedding) >= match_threshold
  ORDER BY h.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- service_role already has broad grants in Supabase, but pin these explicitly:
-- search is read-only for anon/authenticated, writes stay service_role only.
GRANT EXECUTE ON FUNCTION public.match_help_articles_v2(vector, text, integer, double precision)
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.upsert_help_embedding_v2(text, vector, text, timestamptz)
  TO service_role;

NOTIFY pgrst, 'reload schema';
