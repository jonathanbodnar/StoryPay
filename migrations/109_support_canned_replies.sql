-- 109_support_canned_replies.sql
-- ============================================================================
-- Saved replies / canned templates for the support inbox + venue conversations.
--
-- Templates support merge variables:
--   {{bride_first_name}}, {{bride_last_name}}
--   {{venue_name}}, {{venue_persona}}
--   {{agent_name}}
--
-- Scope controls who sees the template in their picker:
--   admin  - shown only in the super-admin support inbox reply box
--   venue  - shown only in the venue's own conversations composer
--   both   - shown to both
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.support_canned_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'both' CHECK (scope IN ('admin', 'venue', 'both')),
  shortcut TEXT,                   -- optional /slash filter (e.g. "/tour")
  category TEXT,                   -- optional grouping label
  channels TEXT[] NOT NULL DEFAULT ARRAY['sms','email']::TEXT[],
  use_count INT NOT NULL DEFAULT 0,
  created_by_support_user_id UUID REFERENCES public.support_team_members(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_canned_replies_scope    ON public.support_canned_replies (scope);
CREATE INDEX IF NOT EXISTS idx_support_canned_replies_category ON public.support_canned_replies (category);
CREATE INDEX IF NOT EXISTS idx_support_canned_replies_shortcut ON public.support_canned_replies (shortcut);

-- Updated_at touch trigger (idempotent)
CREATE OR REPLACE FUNCTION public.support_canned_replies_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_support_canned_replies_touch ON public.support_canned_replies;
CREATE TRIGGER trg_support_canned_replies_touch
  BEFORE UPDATE ON public.support_canned_replies
  FOR EACH ROW EXECUTE FUNCTION public.support_canned_replies_touch_updated_at();

NOTIFY pgrst, 'reload schema';

-- Seed a small starter set so first-time install isn't an empty list.
-- Each is a generic, channel-agnostic snippet. Editable in the admin UI.
INSERT INTO public.support_canned_replies (title, body, scope, shortcut, category)
SELECT * FROM (VALUES
  (
    'Warm intro',
    'Hi {{bride_first_name}}! Thanks so much for reaching out about {{venue_name}} — we''d love to learn a bit more about your day. When were you hoping to celebrate?',
    'both',
    '/intro',
    'greeting'
  ),
  (
    'Tour invite',
    'Hi {{bride_first_name}}, would love to show you {{venue_name}} in person — we have a few openings this week and next. Any chance you''re free for a 30-minute walk-through? I can send a couple of times that work.',
    'both',
    '/tour',
    'tour'
  ),
  (
    'Pricing redirect',
    'Great question! Pricing depends on the date and the package, so I''d love to walk you through the options on a quick call. Could we hop on for 10 minutes this week?',
    'both',
    '/pricing',
    'pricing'
  ),
  (
    'Date check',
    'Hi {{bride_first_name}}! Let me check {{venue_name}}''s calendar for that weekend and circle right back. Could you share your top two date options?',
    'both',
    '/dates',
    'availability'
  ),
  (
    'Soft re-engage',
    'Hey {{bride_first_name}} — just floating back to the top of your inbox in case my last note got buried. Are you still considering {{venue_name}} for the big day? Happy to answer anything that''s come up.',
    'both',
    '/checkin',
    'follow_up'
  )
) AS seed(title, body, scope, shortcut, category)
WHERE NOT EXISTS (SELECT 1 FROM public.support_canned_replies LIMIT 1);
