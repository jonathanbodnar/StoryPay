-- ============================================================================
-- Migration 099 — AI Concierge runtime settings (global kill-switch)
-- ----------------------------------------------------------------------------
-- A singleton row that the AI Concierge crons consult before doing any work.
-- When kill_switch_enabled=true, both ai-activate and ai-send short-circuit
-- immediately (logged in their JSON response so we can tell at a glance from
-- the Railway scheduler dashboard). This is the "stop the world" lever for
-- the super admin if something goes wrong (LLM returning nonsense, runaway
-- spend, compliance event, etc.).
--
-- The single-row constraint is enforced by `id INTEGER CHECK (id = 1)` so
-- we never accidentally produce multiple settings rows. Idempotent via
-- IF NOT EXISTS + ON CONFLICT.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_runtime_settings (
  id                    INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  kill_switch_enabled   BOOLEAN     NOT NULL DEFAULT false,
  kill_switch_reason    TEXT,
  kill_switch_set_by    TEXT,                       -- e.g. 'admin', 'system'
  kill_switch_set_at    TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.ai_runtime_settings (id, kill_switch_enabled)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

-- Tell PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
