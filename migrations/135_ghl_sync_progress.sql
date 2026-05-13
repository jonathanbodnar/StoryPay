-- GHL contact sync progress — tracks the current state of an in-flight (or
-- last completed) sync for a venue so the UI can render a progress bar.
--
-- Shape:
--   {
--     "status":       "running" | "completed" | "failed",
--     "started_at":   ISO8601,
--     "updated_at":   ISO8601,
--     "completed_at": ISO8601 | null,
--     "fetched":      integer,         -- contacts pulled from GHL so far
--     "total":        integer | null,  -- v1 meta.total when available
--     "created":      integer,
--     "updated":      integer,
--     "linked":       integer,
--     "errors":       integer,
--     "error":        string | null,   -- last error message when status='failed'
--     "page":         integer          -- pages of 100 processed so far
--   }
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS ghl_sync_progress jsonb DEFAULT NULL;
