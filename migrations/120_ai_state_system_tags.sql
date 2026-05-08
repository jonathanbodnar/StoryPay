-- ============================================================================
-- Migration 120 — AI Concierge state system tags
--
-- Creates a set of reserved system tags per venue that mirror the lead's
-- ai_state column. Whenever the AI state changes, the app code keeps the
-- tag in sync (one of these is applied at any time, others removed).
--
-- This makes AI status visible in the lead's tag list and in any future
-- segment / filter / automation that operates on tags.
--
-- The tags are flagged is_system=true so the venue UI hides the
-- delete/rename buttons (existing system-tag conventions, see migration 085).
--
-- Idempotent: safe to re-run. Uses the existing
-- (venue_id, system_key) UNIQUE INDEX from migration 085.
-- ============================================================================

INSERT INTO public.marketing_tags (venue_id, name, icon, color, is_system, system_key, category, description, position)
SELECT
  v.id,
  spec.name,
  spec.icon,
  spec.color,
  TRUE,
  spec.system_key,
  'ai_concierge',
  spec.description,
  spec.position
FROM public.venues v
CROSS JOIN (VALUES
  ('AI Active',     '🤖', '#10b981', 'ai_active',     'Lead is currently being followed up by the AI Concierge.',           910),
  ('AI Paused',     '⏸',  '#f59e0b', 'ai_paused',     'AI Concierge follow-ups are temporarily paused for this lead.',      911),
  ('AI Handoff',    '🤝', '#6366f1', 'ai_handoff',    'AI Concierge has handed this lead off to a human team member.',      912),
  ('AI Opted Out',  '🚫', '#ef4444', 'ai_opted_out',  'Lead has opted out of AI follow-ups (STOP keyword or DND).',         913),
  ('AI Exhausted',  '⌛', '#6b7280', 'ai_exhausted',  'AI Concierge has reached the maximum follow-up attempts for this lead.', 914)
) AS spec(name, icon, color, system_key, description, position)
ON CONFLICT (venue_id, system_key) WHERE system_key IS NOT NULL DO NOTHING;

NOTIFY pgrst, 'reload schema';
