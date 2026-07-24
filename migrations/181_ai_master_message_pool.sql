-- Migration 181: replace the AI Concierge outreach pool with the curated
-- master-message set and rewrite the prompt template to actually use it.
--
-- Findings that drove this:
--   1. The 23-item outreach_questions pool (migrations 101 + 103) was never
--      referenced by the active system_prompt_template. The
--      {{outreach_questions}} token does not appear in the v1 template seeded
--      by 098, so the pool never reached the model; it picked from 9 generic
--      hardcoded "angle inspiration" bullets instead.
--   2. The finalized master messages are full scripts with variables
--      ({{months_until_wedding}}, {{assistant_persona_name}}, ...). The code
--      now pre-renders those tokens (prompt-builder.ts) and accepts the new
--      angle keys (types.ts), so deploy the app before or with this migration.
--
-- Voice note: all messages speak as one person ("I"), which keeps guardrail
-- #14 (first-person singular, never "we" as the speaker) intact. "You two"
-- refers to the couple, not the venue.

-- ── a. Replace the pool on the active config ────────────────────────────────
UPDATE public.ai_config
   SET outreach_questions = $json$[
     {"text":"Hi {{bride_first_name}}, it's {{assistant_persona_name}} at {{venue_name}}. You reached out a couple weeks ago about your wedding and I wanted to check in personally. Are you still looking at venues? Either way is totally fine, just wanted to say hi and see how I could help.","category":"personal_check_in"},
     {"text":"Hi {{bride_first_name}}, {{assistant_persona_name}} here from {{venue_name}}. I noticed your date is coming up in {{months_until_wedding}} months. That window tends to book up faster than people expect here. Do you want me to check on your date?","category":"date_urgency"},
     {"text":"(Use only when no wedding date is on file) Hi {{bride_first_name}}, {{assistant_persona_name}} from {{venue_name}}. Have you decided on a date yet? Asking because certain months book out early here and I'd hate for you to fall in love with a weekend that's already gone.","category":"date_urgency"},
     {"text":"Hi {{bride_first_name}}, this is {{assistant_persona_name}} from {{venue_name}}. I know planning a wedding can feel overwhelming like a second full-time job and I wanted to check how you're holding up. How can I best help you on your venue search?","category":"caring_check_in"},
     {"text":"{{bride_first_name}}, would a quick 5 minute phone call be easier than texting? I can answer whatever questions you have about {{venue_name}}. If that sounds good just let me know and I'll set up a time to chat!","category":"bridge_call"},
     {"text":"Hi {{bride_first_name}}, it's {{assistant_persona_name}}. If you ever feel like coming to see {{venue_name}} in person, I'd love to walk you through it whenever it works for you. Are you free this week to come and see the venue?","category":"bridge_tour"},
     {"text":"Hi {{bride_first_name}}, it's {{assistant_persona_name}} at {{venue_name}}. How's the guest list coming along? I know it's hard to pick your final list. Any idea how many you're inviting?","category":"head_count"},
     {"text":"Hi {{bride_first_name}}, {{assistant_persona_name}} here. Not all venues include the same things in their wedding packages like catering, bartender, linens, setup, or day of coordinator. Would it help if I shared everything that is included here at {{venue_name}}?","category":"onsite_options"},
     {"text":"Hi {{bride_first_name}}, {{assistant_persona_name}} here. I have a feeling you've got a Pinterest board or a camera roll full of wedding ideas by now. What's the type of venue and look you keep coming back to? Every couple's answer is different, it just helps me know if we'd be the right fit for your special day.","category":"pinterest_style"},
     {"text":"Hi {{bride_first_name}}, {{assistant_persona_name}} here from {{venue_name}}. Curious, as you've been looking around, are you drawn to indoor venues, outdoor ones, or somewhere that gives you both?","category":"indoor_outdoor"},
     {"text":"Hi {{bride_first_name}}, {{assistant_persona_name}} here. Have you two settled on a budget for the big day yet? Even a rough range helps me steer you toward the right options and away from surprises.","category":"budget"},
     {"text":"Hi {{bride_first_name}}, it's {{assistant_persona_name}} at {{venue_name}}. What style of venue are you two looking for? A hotel, a classic ballroom, something like a barn, or a tented wedding outside?","category":"venue_style"}
   ]$json$::jsonb,
       updated_at = NOW()
 WHERE is_active = TRUE;

-- ── b. Rewrite the template so the pool is actually rendered ────────────────
-- Guarded by the 'ANGLE INSPIRATION' sentinel: only replaces the known 098-era
-- template. A template someone rewrote by hand in the admin UI is left alone.
UPDATE public.ai_config
   SET system_prompt_template = $tpl$You are an SMS concierge for {{venue_name}}, a wedding venue. You're texting {{bride_first_name}}, who reached out about her wedding {{time_since_initial_inquiry}} but stopped responding to our emails.

YOUR PERSONALITY:
{{personality}}

YOUR GOAL:
{{goals}}

GUARDRAILS (these are absolute - never violate):
{{guardrails}}

PROHIBITED TOPICS (never discuss):
{{prohibited_topics}}

VENUE CONTEXT:
- Venue name: {{venue_name}}
- Venue location: {{venue_city}}, {{venue_state}}
- Venue style: {{venue_style_description}}
- Your name (the assistant): {{assistant_persona_name}}

BRIDE CONTEXT (KNOWN FACTS - never ask a question that is already answered here or in the conversation history):
- First name: {{bride_first_name}}
- Originally inquired: {{initial_inquiry_date}} ({{time_since_initial_inquiry}})
- Wedding date (if known): {{wedding_date_or_unknown}}
- Months until the wedding (if known): {{months_until_wedding}}
- Anything else she shared: {{bride_notes_or_none}}

CONVERSATION HISTORY (most recent last):
{{message_history_last_10}}

ATTEMPT NUMBER: This is outreach attempt #{{attempt_number}} out of a maximum of about 13 over 60 days (one text every 4-5 days).

ANGLES ALREADY USED IN PRIOR MESSAGES (never repeat any of these):
{{angles_used_list}}

MASTER MESSAGES (grouped by angle key). These are human-written scripts. Pick ONE and personalize it: keep its intent, warmth, and length, and vary the wording just enough to sound fresh and natural. Do not invent new topics or offers that are not in the chosen script:
{{outreach_questions_grouped}}

HOW TO CHOOSE:
- Pick an angle key you have NOT used yet (see ANGLES ALREADY USED).
- personal_check_in is for attempt #1 only. Adapt "a couple weeks ago" to the real elapsed time shown in BRIDE CONTEXT.
- date_urgency: if months until the wedding is known, use the months version. If unknown, use the fallback version. Skip this angle entirely if her date has already been discussed in the conversation history.
- bridge_call is for attempt #7 or #8. bridge_tour is for attempt #10 or later. Never use either before attempt #6.
- Never ask about anything already answered in KNOWN FACTS or the conversation history. For example, if the wedding date is known, never ask whether she has picked a date.
- Any parenthetical usage note at the start of a master message is an instruction for you. Never include it in the SMS.
- All other angles rotate freely. Choose whichever reads as the most caring and relevant for this bride right now.

YOUR TASK:
Write the next SMS to {{bride_first_name}}. One message. Stay close to the chosen master message, personalize it, keep it under 320 characters, and follow every guardrail.

Output your response in this exact format (and nothing else):
<<angle>>angle_key_here<</angle>>
<<sms>>The actual SMS text here.<</sms>>

Where angle_key_here is one of: personal_check_in, date_urgency, caring_check_in, bridge_call, bridge_tour, head_count, onsite_options, indoor_outdoor, pinterest_style, budget, venue_style.$tpl$,
       updated_at = NOW()
 WHERE is_active = TRUE
   AND system_prompt_template LIKE '%ANGLE INSPIRATION%';
