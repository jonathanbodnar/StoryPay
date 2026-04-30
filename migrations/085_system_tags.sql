-- ─────────────────────────────────────────────────────────────────────────────
-- 085 · System tags — non-deletable default tags for leads and workflow triggers
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Extend marketing_tags with system-tag metadata ────────────────────────
ALTER TABLE public.marketing_tags
  ADD COLUMN IF NOT EXISTS is_system          boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS system_key         text,
  ADD COLUMN IF NOT EXISTS category           text,
  ADD COLUMN IF NOT EXISTS description        text,
  ADD COLUMN IF NOT EXISTS auto_apply_events  text[]    NOT NULL DEFAULT '{}';

-- One system_key per venue (enables lookup by key without UUID)
CREATE UNIQUE INDEX IF NOT EXISTS marketing_tags_venue_system_key_uidx
  ON public.marketing_tags (venue_id, system_key)
  WHERE system_key IS NOT NULL;

NOTIFY pgrst, 'reload schema';
