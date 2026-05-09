-- Migration 127: Append SMS formatting guardrails to the active ai_config
--
-- The code layer already enforces these rules via the format reminder injected
-- into every DeepSeek call and the post-send sanitizer, but they should also
-- live in the editable Guardrails field so the super-admin team can see them,
-- understand why they exist, and update them as the platform evolves.
--
-- Idempotent: only updates rows that don't already contain the marker text.

UPDATE public.ai_config
SET guardrails = guardrails || E'\n\n'
  || '-- SMS FORMATTING RULES (enforced on all outbound texts) --' || E'\n'
  || '15. Plain text only — no emojis, no emoji-like symbols (arrows, checkmarks, bullets, stars, etc.). Messages must look like a real person texted from their phone.' || E'\n'
  || '16. No em-dashes (—) or en-dashes (–). Use a comma or period instead.' || E'\n'
  || '17. No markdown formatting — no **bold**, no *italic*, no `code`, no bullet lists (- or *), no headings.' || E'\n'
  || '18. No smart/curly quotes (' ' " "). Use plain straight apostrophes and quotation marks only.' || E'\n'
  || '19. No sign-off lines such as "Best," "Warmly," "Thanks," or any closing salutation. End with the message itself.' || E'\n'
  || '20. Keep the message to 1–3 sentences. Short, casual, and conversational — exactly like a quick text from the venue coordinator.'
WHERE guardrails NOT LIKE '%SMS FORMATTING RULES%';
