-- ============================================================================
-- Migration 103 — AI Concierge outreach pool — emotional reply-trigger seed
-- ----------------------------------------------------------------------------
-- Appends 15 polished, first-person inspiration messages to the active
-- ai_config row's `outreach_questions` pool. These are derived from a
-- venue-owner-authored set whose ONLY goal is to encourage brides to reply.
--
-- Categories used (in addition to the existing discovery / qualifying / cta /
-- objection / general):
--   - check_in     → light "how's it going" touches, no ask
--   - reassurance  → emotional support, normalizing the planning grind
--   - soft_cta     → low-pressure offers (5-min chat, no rush)
--   - vibe         → philosophical, gut-trust, perspective-builders
--
-- Format note: each entry is written first-person so the LLM receives them
-- as "examples of the kind of message I send" — the prompt template still
-- instructs the model to rephrase in its own voice, never copy verbatim.
-- Variables like {{contact.first_name}} are intentionally STRIPPED — the
-- prompt builder injects bride first-name via {{bride_first_name}} into
-- the system prompt, so the AI personalizes naturally.
--
-- Idempotency: guarded by a sentinel string ("Just saying hi again"). Safe
-- to re-run; will not duplicate entries.
-- ============================================================================

UPDATE public.ai_config
   SET outreach_questions = COALESCE(outreach_questions, '[]'::jsonb) || '[
     {"text":"Just saying hi again — how is wedding planning coming along?","category":"check_in"},
     {"text":"Wedding planning can feel overwhelming. I hope you are giving yourself grace through it — it is supposed to be exciting too.","category":"reassurance"},
     {"text":"If you ever want to hop on a quick 5-minute chat to go over pricing or check your date, I am here whenever you are ready. No rush at all.","category":"soft_cta"},
     {"text":"I am curious — have you had a chance to visit any venues yet? Would love to hear how the search is going.","category":"discovery"},
     {"text":"One thing I always tell couples: trust your gut. When you walk into the right venue, you will feel it. That moment is worth waiting for.","category":"vibe"},
     {"text":"Quick question — are you still looking for the right venue? If so, I would love a few minutes to chat and see if we might be a good fit.","category":"soft_cta"},
     {"text":"A lot of brides tell me the hardest part is figuring out what is actually included in pricing. If that has been frustrating, happy to walk you through how we do things — it is pretty straightforward.","category":"objection"},
     {"text":"How are you doing with everything? Planning a wedding can feel like a second job on top of your actual job. If there is anything I can help with, I am right here.","category":"check_in"},
     {"text":"Hope whoever you end up choosing makes you feel like your wedding is the most important event they have ever hosted. You deserve that kind of attention.","category":"vibe"},
     {"text":"Do not want to be a bother — just want you to know we are still here. If a quick 5-min chat would help at any point, just say the word.","category":"soft_cta"},
     {"text":"What has been the most important thing to you so far in your venue search? Everyone has a different answer and I love hearing it.","category":"discovery"},
     {"text":"I know how many options are out there — it can feel like every venue starts to blend together. When the right one stands out, you will know.","category":"vibe"},
     {"text":"One thing couples tell us they appreciated is that we are upfront about everything — pricing, availability, what is included, what is not. If that matters to you, would love a few minutes to walk you through it all.","category":"objection"},
     {"text":"If your plans have changed or you have already found your venue, I am genuinely happy for you. If you are still searching, I would love a few minutes to chat. Either way, wishing you the best.","category":"soft_cta"},
     {"text":"Whatever stage you are at, I hope you are enjoying this time. Planning a wedding is stressful but it is also one of the most special seasons you will ever have. Rooting for you.","category":"vibe"}
   ]'::jsonb
 WHERE is_active = true
   -- Idempotency guard: skip if the new pool has already been merged in.
   AND outreach_questions::text NOT LIKE '%Just saying hi again%';

-- Refresh PostgREST schema cache so any clients refetch the updated row.
NOTIFY pgrst, 'reload schema';
