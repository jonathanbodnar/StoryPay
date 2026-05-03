-- Migration 098: AI Concierge
-- Adds the schema for the per-bride AI SMS follow-up feature.
--
-- Sections:
--   1. venues columns + eligibility constraint
--   2. leads columns + ai_state enum check + indexes
--   3. conversation_messages.sender_kind extended to include 'ai'
--   4. trigger to maintain leads.last_inbound_at / last_outbound_at
--   5. ai_config (global, versioned) + initial v1 row
--   6. handoff_rules + 8 starter rows
--   7. ai_runs (per-attempt log)
--   8. ai_state_transitions (audit log)
--
-- Idempotent: safe to re-run.

-- ============================================================================
-- 1. venues — AI feature flags + provider config
-- ============================================================================
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS ai_concierge_enabled       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS a2p_verified               BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_provider               TEXT        NOT NULL DEFAULT 'ghl',
  ADD COLUMN IF NOT EXISTS ai_concierge_resources     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_concierge_notify_emails TEXT[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_assistant_persona_name  TEXT        NOT NULL DEFAULT 'Alison',
  ADD COLUMN IF NOT EXISTS ai_concierge_enabled_by    UUID,
  ADD COLUMN IF NOT EXISTS ai_concierge_enabled_at    TIMESTAMPTZ;

-- AI can only be enabled if the addon is purchased AND venue is A2P-verified.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'venues_ai_concierge_eligibility_check'
  ) THEN
    ALTER TABLE public.venues
      ADD CONSTRAINT venues_ai_concierge_eligibility_check
      CHECK (
        NOT ai_concierge_enabled
        OR (a2p_verified = TRUE AND directory_addon_concierge = TRUE)
      );
  END IF;
END $$;

-- ============================================================================
-- 2. leads — AI state machine + activity timestamps
-- ============================================================================
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS ai_state              TEXT        NOT NULL DEFAULT 'dormant',
  ADD COLUMN IF NOT EXISTS ai_first_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_expires_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_next_send_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_attempt_count      INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_re_enabled_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_re_enable_count    INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_angles_used        TEXT[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_inbound_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_outbound_at      TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_ai_state_check'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_ai_state_check
      CHECK (ai_state IN ('dormant', 'ai_active', 'paused', 'exhausted', 'opted_out', 'handoff'));
  END IF;
END $$;

-- Indexes powering the activation and send crons
CREATE INDEX IF NOT EXISTS leads_ai_send_due_idx
  ON public.leads (ai_next_send_at)
  WHERE ai_state = 'ai_active';

CREATE INDEX IF NOT EXISTS leads_ai_state_venue_idx
  ON public.leads (venue_id, ai_state);

CREATE INDEX IF NOT EXISTS leads_ai_dormant_outbound_idx
  ON public.leads (last_outbound_at)
  WHERE ai_state = 'dormant';

CREATE INDEX IF NOT EXISTS leads_ai_re_enabled_idx
  ON public.leads (ai_next_send_at)
  WHERE ai_state = 'dormant' AND ai_re_enabled_at IS NOT NULL;

-- ============================================================================
-- 3. conversation_messages — extend sender_kind to include 'ai'
-- ============================================================================
ALTER TABLE public.conversation_messages
  DROP CONSTRAINT IF EXISTS conversation_messages_sender_kind_check;

ALTER TABLE public.conversation_messages
  ADD CONSTRAINT conversation_messages_sender_kind_check
  CHECK (sender_kind IN ('owner', 'team', 'contact', 'system', 'ai'));

-- ============================================================================
-- 4. Trigger: maintain leads.last_inbound_at / last_outbound_at
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ai_concierge_touch_lead_message_timestamps()
RETURNS TRIGGER AS $$
DECLARE
  v_venue_id UUID;
  v_email    TEXT;
BEGIN
  SELECT vc.venue_id, vc.customer_email
    INTO v_venue_id, v_email
    FROM public.conversation_threads ct
    JOIN public.venue_customers vc ON vc.id = ct.venue_customer_id
   WHERE ct.id = NEW.thread_id;

  IF v_venue_id IS NULL OR v_email IS NULL OR v_email = '' THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_kind = 'contact' THEN
    UPDATE public.leads
       SET last_inbound_at = NEW.created_at
     WHERE venue_id = v_venue_id
       AND lower(email) = lower(v_email);
  ELSIF NEW.sender_kind IN ('owner', 'team', 'system', 'ai') THEN
    UPDATE public.leads
       SET last_outbound_at = NEW.created_at
     WHERE venue_id = v_venue_id
       AND lower(email) = lower(v_email);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_concierge_touch_lead_timestamps ON public.conversation_messages;
CREATE TRIGGER trg_ai_concierge_touch_lead_timestamps
  AFTER INSERT ON public.conversation_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.ai_concierge_touch_lead_message_timestamps();

-- One-time backfill of timestamps from existing message history
UPDATE public.leads l
   SET last_inbound_at = sub.last_in
  FROM (
    SELECT vc.venue_id, lower(vc.customer_email) AS email_l, MAX(cm.created_at) AS last_in
      FROM public.conversation_messages cm
      JOIN public.conversation_threads ct ON ct.id = cm.thread_id
      JOIN public.venue_customers vc ON vc.id = ct.venue_customer_id
     WHERE cm.sender_kind = 'contact'
     GROUP BY vc.venue_id, lower(vc.customer_email)
  ) sub
 WHERE l.venue_id = sub.venue_id
   AND lower(l.email) = sub.email_l
   AND l.last_inbound_at IS NULL;

UPDATE public.leads l
   SET last_outbound_at = sub.last_out
  FROM (
    SELECT vc.venue_id, lower(vc.customer_email) AS email_l, MAX(cm.created_at) AS last_out
      FROM public.conversation_messages cm
      JOIN public.conversation_threads ct ON ct.id = cm.thread_id
      JOIN public.venue_customers vc ON vc.id = ct.venue_customer_id
     WHERE cm.sender_kind IN ('owner', 'team', 'system', 'ai')
     GROUP BY vc.venue_id, lower(vc.customer_email)
  ) sub
 WHERE l.venue_id = sub.venue_id
   AND lower(l.email) = sub.email_l
   AND l.last_outbound_at IS NULL;

-- ============================================================================
-- 5. ai_config — global versioned prompt configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ai_config (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  version                  INTEGER      NOT NULL,
  is_active                BOOLEAN      NOT NULL DEFAULT FALSE,
  personality              TEXT         NOT NULL DEFAULT '',
  goals                    TEXT         NOT NULL DEFAULT '',
  guardrails               TEXT         NOT NULL DEFAULT '',
  prohibited_topics        TEXT         NOT NULL DEFAULT '',
  message_constraints      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  system_prompt_template   TEXT         NOT NULL DEFAULT '',
  notes                    TEXT,
  created_by               TEXT,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_config_version_uniq
  ON public.ai_config (version);

CREATE UNIQUE INDEX IF NOT EXISTS ai_config_only_one_active
  ON public.ai_config (is_active)
  WHERE is_active = TRUE;

-- Seed v1 (only if no rows exist yet)
INSERT INTO public.ai_config (
  version, is_active, personality, goals, guardrails, prohibited_topics,
  message_constraints, system_prompt_template, notes
)
SELECT
  1,
  TRUE,
  $personality$You are a warm, friendly, low-pressure concierge for a wedding venue. You text like a thoughtful human assistant who happens to work at the venue — not like a salesperson and definitely not like a chatbot.

Your tone is warm but never gushing (no "OMG" or excessive exclamation points), conversational and casual like texting a friend who works in events, confident but not pushy, brief (real people send short texts — long texts feel like marketing), and human (use contractions, vary sentence length, occasionally start a sentence with "And" or "But").

You are NOT overly formal or corporate, salesy or hype-y, robotic, apologetic or weak, or repetitive. You never recycle the same opener or hook across messages.

You write at roughly an 8th-grade reading level. Short words. Short sentences. The way real people text.$personality$,
  $goals$Primary goal: Get the bride to reply. Any reply. That's it. Once she replies, your job is done — a human takes over.

You are NOT trying to book the venue, schedule a tour (unless she asks), quote prices, sell anything, or answer detailed questions about the venue.

You ARE trying to re-engage a bride who went quiet, make her feel like a real person at the venue noticed her and cares, give her an easy low-pressure reason to reply, and vary your approach across messages so it doesn't feel like spam.

Success looks like: she texts back literally anything. The moment she replies, you stop. Humans take it from there.$goals$,
  $guardrails$1. Never quote prices, rates, packages, or any cost figures. If she asks, redirect: "Our coordinator handles all the pricing details — I'll have her reach out with options. What date are you considering?"
2. Never claim to be human if asked directly. Be honest: "I'm an assistant helping the team follow up — happy to connect you with the venue's coordinator directly if you'd like to chat with her."
3. Never make promises about availability, dates, or anything contractual.
4. Never invent details about the venue. Stick to what's in the venue context provided.
5. Never mention competitors by name, even if she does.
6. Never send more than 2 SMS segments (320 characters). One segment (160 chars) is strongly preferred.
7. Never include links in the first 4 messages. After 4 messages with no reply, a single link is okay if relevant.
8. Never use emojis in the first message. Sparingly after that — max one per message.
9. Never reference how long it's been since she last replied. Don't say "haven't heard from you" or "checking in again."
10. Never ask more than one question per message.
11. Never repeat the same opening line, hook, or angle from previous messages in this conversation.
12. Never assume the wedding is happening. Stay neutral.
13. Never use her full name in SMS. First name only.
14. Always sound like a single person at the venue, not a team or "we." First-person singular.$guardrails$,
  $prohibited$Pricing, rates, packages, deposits, payment plans. Specific availability or calendar dates. Catering specifics, vendor recommendations, contracts. Other brides or weddings. Religious or political topics. Anything legal, contractual, or refund-related. Competitors. Anything you're not 100% certain about regarding the venue.

If she brings any of these up, acknowledge briefly and route to a human: "Great question — our coordinator handles all of that and can give you real answers. I'll have her reach out. What's the best time to text?"$prohibited$,
  $constraints${
    "max_chars": 320,
    "preferred_chars": 160,
    "max_emojis": 1,
    "first_message_emojis_allowed": false,
    "max_questions_per_message": 1,
    "links_allowed_after_attempt": 4,
    "first_name_only": true,
    "quiet_hours_start_local": "20:00",
    "quiet_hours_end_local": "09:00"
  }$constraints$::jsonb,
  $template$You are an SMS concierge for {{venue_name}}, a wedding venue. You're texting {{bride_first_name}}, who reached out about her wedding {{time_since_initial_inquiry}} but stopped responding to our emails.

YOUR PERSONALITY:
{{personality}}

YOUR GOAL:
{{goals}}

GUARDRAILS (these are absolute — never violate):
{{guardrails}}

PROHIBITED TOPICS (never discuss):
{{prohibited_topics}}

VENUE CONTEXT:
- Venue name: {{venue_name}}
- Venue location: {{venue_city}}, {{venue_state}}
- Venue style: {{venue_style_description}}
- Your name (the assistant): {{assistant_persona_name}}

BRIDE CONTEXT:
- First name: {{bride_first_name}}
- Originally inquired: {{initial_inquiry_date}}
- Wedding date (if known): {{wedding_date_or_unknown}}
- Anything else she shared: {{bride_notes_or_none}}

CONVERSATION HISTORY (most recent last):
{{message_history_last_10}}

ATTEMPT NUMBER: This is outreach attempt #{{attempt_number}} out of a maximum of around 20-40 over 60 days.

ANGLES ALREADY USED IN PRIOR MESSAGES (do not repeat):
{{angles_used_list}}

ANGLE INSPIRATION (use as inspiration, never copy verbatim — write in your own voice):
- casual_check_in — Casual check-in
- wedding_vision — Specific question about her wedding vision (indoor vs outdoor, season, vibe)
- permission_to_ghost — Permission to ghost ("no pressure at all")
- helpful_offer — Helpful offer ("happy to share something useful even if we're not the right fit")
- curiosity_process — Curiosity about her process ("what's been the hardest part of venue hunting?")
- date_driven — Date-driven ("are you still aiming for [season]?")
- soft_reintroduction — Soft re-introduction ("wanted to introduce myself properly")
- acknowledge_overwhelm — Acknowledgment of overwhelm ("venue hunting can be a lot")
- open_ended — Open-ended ("what's top of mind wedding-wise these days?")

YOUR TASK:
Write the next SMS to {{bride_first_name}}. One message. Under 160 characters if possible, never over 320. No links. Match the personality and follow every guardrail. Pick a fresh angle she hasn't seen yet — something casual, low-pressure, and human. Your goal is just to get her to reply.

Output your response in this exact format (and nothing else):
<<angle>>angle_key_here<</angle>>
<<sms>>The actual SMS text here.<</sms>>

Where angle_key_here is one of the keys from the ANGLE INSPIRATION list above (e.g. casual_check_in, wedding_vision, permission_to_ghost, etc.).$template$,
  'Initial system prompt seeded with migration 098.'
WHERE NOT EXISTS (SELECT 1 FROM public.ai_config);

-- ============================================================================
-- 6. handoff_rules — global rules for inbound classification
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.handoff_rules (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type       TEXT         NOT NULL CHECK (rule_type IN ('keyword', 'intent')),
  trigger_value   TEXT         NOT NULL,
  action          TEXT         NOT NULL CHECK (action IN ('opt_out', 'stop_and_handoff', 'mark_not_interested')),
  notify_roles    TEXT[]       NOT NULL DEFAULT '{}',
  tags_to_apply   TEXT[]       NOT NULL DEFAULT '{}',
  pipeline_stage  TEXT,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  position        INTEGER      NOT NULL DEFAULT 0,
  description     TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS handoff_rules_active_idx
  ON public.handoff_rules (is_active, position)
  WHERE is_active = TRUE;

-- Seed starter rules (idempotent — only insert if no rows exist)
INSERT INTO public.handoff_rules (rule_type, trigger_value, action, notify_roles, tags_to_apply, pipeline_stage, position, description)
SELECT * FROM (VALUES
  ('keyword', '\b(stop|unsubscribe|remove me|opt[ -]?out|quit|end|cancel)\b',
    'opt_out',           ARRAY['venue_owner']::TEXT[],
    ARRAY['ai_not_interested']::TEXT[],            'not_interested',        10, 'TCPA hard opt-out keywords (STOP, UNSUBSCRIBE, etc.)'),
  ('keyword', '\b(lawyer|attorney|legal|sue|lawsuit)\b',
    'stop_and_handoff',  ARRAY['venue_owner','concierge']::TEXT[],
    ARRAY['ai_replied','ai_needs_human']::TEXT[],  'conversation_started',  20, 'Legal/attorney mentions — escalate immediately'),
  ('keyword', '\b(manager|supervisor|owner|escalate)\b',
    'stop_and_handoff',  ARRAY['venue_owner','concierge']::TEXT[],
    ARRAY['ai_replied','ai_needs_human']::TEXT[],  'conversation_started',  30, 'Asking for management/supervision — escalate'),
  ('keyword', '\b(complaint|refund|scam|fraud)\b',
    'stop_and_handoff',  ARRAY['venue_owner','concierge']::TEXT[],
    ARRAY['ai_replied','ai_needs_human']::TEXT[],  'conversation_started',  40, 'Complaint/refund/fraud — escalate to humans'),
  ('keyword', '\b(price|pricing|cost|how much|rate|quote|fee|deposit)\b',
    'stop_and_handoff',  ARRAY['concierge']::TEXT[],
    ARRAY['ai_replied','ai_needs_human']::TEXT[],  'conversation_started',  50, 'Pricing question — coordinator should respond personally'),
  ('keyword', '\b(human|real person|bot|ai|robot|are you (a |an )?(person|human|bot|ai))\b',
    'stop_and_handoff',  ARRAY['concierge']::TEXT[],
    ARRAY['ai_replied','ai_needs_human']::TEXT[],  'conversation_started',  60, '"Are you a bot?" — handoff to a real human'),
  ('intent',  'booked_elsewhere',
    'mark_not_interested', ARRAY['venue_owner']::TEXT[],
    ARRAY['ai_not_interested']::TEXT[],            'not_interested',       110, 'Bride mentions she chose another venue'),
  ('intent',  'not_interested',
    'mark_not_interested', ARRAY['venue_owner']::TEXT[],
    ARRAY['ai_not_interested']::TEXT[],            'not_interested',       120, 'Bride explicitly says she is not interested')
) AS v(rule_type, trigger_value, action, notify_roles, tags_to_apply, pipeline_stage, position, description)
WHERE NOT EXISTS (SELECT 1 FROM public.handoff_rules);

-- ============================================================================
-- 7. ai_runs — log of every AI generation + send attempt
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ai_runs (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id               UUID         NOT NULL REFERENCES public.leads(id)  ON DELETE CASCADE,
  venue_id              UUID         NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  ai_config_version     INTEGER,
  attempt_number        INTEGER,
  input_context         JSONB,
  system_prompt         TEXT,
  model_output          TEXT,
  final_sent_text       TEXT,
  angle_used            TEXT,
  sms_provider          TEXT,
  provider_message_id   TEXT,
  outcome               TEXT         NOT NULL,
  error_detail          TEXT,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_runs_venue_created_idx ON public.ai_runs (venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_runs_lead_created_idx  ON public.ai_runs (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_runs_outcome_idx       ON public.ai_runs (outcome, created_at DESC);

-- ============================================================================
-- 8. ai_state_transitions — audit log of every state change
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ai_state_transitions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID         NOT NULL REFERENCES public.leads(id)  ON DELETE CASCADE,
  venue_id     UUID         NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  from_state   TEXT,
  to_state     TEXT         NOT NULL,
  reason       TEXT,
  triggered_by TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_state_transitions_lead_idx  ON public.ai_state_transitions (lead_id,  created_at DESC);
CREATE INDEX IF NOT EXISTS ai_state_transitions_venue_idx ON public.ai_state_transitions (venue_id, created_at DESC);

-- Tell PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
