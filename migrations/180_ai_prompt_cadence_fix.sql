-- Migration 180: fix stale cadence copy in the AI Concierge prompt config
--
-- The v1 prompt seeded by migration 098 tells the model it has "a maximum of
-- around 20-40 [attempts] over 60 days". The overhaul changed the cadence to
-- alternating 4/5-day sends, which fits roughly 13 touches in the 60-day
-- window. The attempt count shapes how the model paces itself, so the prompt
-- needs to match reality. Targeted string replace so any other edits made to
-- the prompt in the admin UI are preserved.

UPDATE public.ai_config
   SET system_prompt_template = replace(
         system_prompt_template,
         'out of a maximum of around 20-40 over 60 days',
         'out of a maximum of about 13 over 60 days (one text every 4-5 days)'
       ),
       updated_at = NOW()
 WHERE system_prompt_template LIKE '%out of a maximum of around 20-40 over 60 days%';
