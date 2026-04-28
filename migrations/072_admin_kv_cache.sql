-- Generic key-value cache for admin-level data (e.g. Google Trends).
-- Persists across server restarts unlike the in-memory Map.

CREATE TABLE IF NOT EXISTS public.admin_kv_cache (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
