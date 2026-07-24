-- 183_ai_prompt_venue_knowledge.sql
--
-- Inject the venue knowledge base into the active AI Concierge prompt. Adds a
-- "VENUE KNOWLEDGE" section (fed by {{venue_knowledge}}) right after the VENUE
-- CONTEXT block, plus a line noting {{venue_detail_highlight}} is the one
-- feature to spotlight.
--
-- Targeted string-append (anchored on "BRIDE CONTEXT:", which immediately
-- follows the VENUE CONTEXT block) so any hand-edits to the rest of the prompt
-- are preserved. Idempotent: the NOT LIKE '%VENUE KNOWLEDGE%' guard means
-- re-running is a no-op and it won't clobber a template that already has it.

UPDATE public.ai_config
   SET system_prompt_template = replace(
         system_prompt_template,
         E'BRIDE CONTEXT:',
         E'VENUE KNOWLEDGE (use ONLY these facts; never invent; never mention pricing):\n{{venue_knowledge}}\n\nThe single feature most worth spotlighting when it fits naturally: {{venue_detail_highlight}}\n\nBRIDE CONTEXT:'
       ),
       updated_at = NOW()
 WHERE system_prompt_template LIKE '%VENUE CONTEXT%'
   AND system_prompt_template LIKE '%BRIDE CONTEXT:%'
   AND system_prompt_template NOT LIKE '%VENUE KNOWLEDGE%';

NOTIFY pgrst, 'reload schema';
