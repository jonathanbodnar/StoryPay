-- ============================================================================
-- Migration 101 — AI Concierge outreach question pool
-- ----------------------------------------------------------------------------
-- Adds a versioned, super-admin-curated list of "questions the AI may pull
-- from when crafting outbound SMS." Examples:
--
--   - "What's the most important thing about your ceremony space?"
--   - "Are you leaning indoor, outdoor, or both?"
--   - "How big is your guest list looking?"
--
-- Stored as JSONB on ai_config so it's:
--   - Versioned alongside the rest of the prompt (rollback in one click).
--   - Visible in the existing Prompt Config Editor + activation flow.
--   - Atomically swapped with the active config row by the existing
--     activate transaction.
--
-- Schema:
--   outreach_questions JSONB NOT NULL DEFAULT '[]'::jsonb
--
-- Each entry is an object: { text: string, category?: string, priority?: int }
-- The prompt-builder renders this as a bulleted list under the
-- {{outreach_questions}} token; the LLM is instructed to phrase one
-- naturally (not copy verbatim).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS guard. Safe to re-run.
-- ============================================================================

ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS outreach_questions JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Seed the currently active version with a small starter pool so the
-- {{outreach_questions}} token has something to render even before an
-- operator curates the list. Skip if the active row already has questions.
UPDATE public.ai_config
   SET outreach_questions = '[
     {"text":"What''s the most important thing about your ceremony space?","category":"discovery"},
     {"text":"Indoor, outdoor, or a mix of both?","category":"discovery"},
     {"text":"How big is your guest list looking right now?","category":"qualifying"},
     {"text":"Have you locked in a date yet, or are you still flexible?","category":"qualifying"},
     {"text":"What''s your dream wedding vibe — modern, classic, romantic, something else?","category":"discovery"},
     {"text":"What does your ideal day look like start to finish?","category":"discovery"},
     {"text":"Any deal-breakers we should know about? (parking, wheelchair access, on-site catering, etc.)","category":"qualifying"},
     {"text":"Would you rather see the venue in person or hop on a quick call first?","category":"cta"}
   ]'::jsonb
 WHERE is_active = true
   AND (outreach_questions IS NULL OR outreach_questions = '[]'::jsonb);

-- Refresh PostgREST schema cache so the new column is queryable.
NOTIFY pgrst, 'reload schema';
