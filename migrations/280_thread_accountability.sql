-- Migration 280: who did what in a bride's thread (owner's asks, Oct 5 2026).
--
-- 1. Texts the venue side sends from OUTSIDE StoryVenue (a person in the
--    CRM's app, a CRM workflow) are now imported into the thread. Until now
--    only the couple's texts were imported, so a thread could read as a
--    bride answering herself (White Pine Manor). Two columns say where such
--    a text was sent from and, when the texting account names them, by whom.
--
-- 2. Every move of a lead to another pipeline stage is written to the lead's
--    activity log by the database itself, whatever moved it (about twenty code
--    paths can: owner, team, support, the AI, automations, forms, Calendly),
--    with who moved it whenever the app says so in the same update. The
--    thread shows those moves as one-line entries to the venue and to
--    support. They never reach the couple: they are not messages.
--
-- Additive and safe to run again.

-- 1. Where a venue-side text was sent from.
ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS sent_via     text,
  ADD COLUMN IF NOT EXISTS sent_by_name text;

ALTER TABLE public.conversation_messages
  DROP CONSTRAINT IF EXISTS conversation_messages_sent_via_check;
ALTER TABLE public.conversation_messages
  ADD CONSTRAINT conversation_messages_sent_via_check
  CHECK (sent_via IS NULL OR sent_via IN ('crm_user', 'crm_workflow', 'crm_api'));

COMMENT ON COLUMN public.conversation_messages.sent_via IS
  'Set on texts imported from the venue''s texting account that StoryVenue did not send: crm_user (a person, from the CRM app), crm_workflow (a CRM automation), crm_api (another app through the CRM). NULL: sent or received through StoryVenue.';
COMMENT ON COLUMN public.conversation_messages.sent_by_name IS
  'The person who sent a crm_user text, when the texting account names them.';

-- 2. Who moved the lead: written by the app in the same update as the move.
--    { "kind": "owner|team|support|ai|automation|couple", "label": "Jo Ann Wilkerson", "member_id": "<uuid>", "at": "<iso>" }
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS stage_changed_by jsonb;

COMMENT ON COLUMN public.leads.stage_changed_by IS
  'Who last moved this lead to its stage, written together with the move (the stage-change log reads it). Not set by a move = an automation.';

CREATE OR REPLACE FUNCTION public.log_lead_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  who    jsonb;
  member uuid;
BEGIN
  IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  -- "Who" counts only when it was written with this very move; otherwise it
  -- is left over from an earlier one and this move was an automation.
  IF NEW.stage_changed_by IS DISTINCT FROM OLD.stage_changed_by THEN
    who := NEW.stage_changed_by;
  END IF;

  BEGIN
    member := NULLIF(who->>'member_id', '')::uuid;
    IF member IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.venue_team_members WHERE id = member) THEN
      member := NULL;
    END IF;
  EXCEPTION WHEN others THEN
    member := NULL;
  END;

  BEGIN
    INSERT INTO public.lead_activity_log (venue_id, lead_id, actor_member_id, actor_is_owner, action, details)
    VALUES (
      NEW.venue_id, NEW.id, member, COALESCE(who->>'kind', '') = 'owner', 'stage_changed',
      jsonb_build_object(
        'from_stage_id',   OLD.stage_id,
        'to_stage_id',     NEW.stage_id,
        'from_stage_name', (SELECT name FROM public.lead_pipeline_stages WHERE id = OLD.stage_id),
        'to_stage_name',   (SELECT name FROM public.lead_pipeline_stages WHERE id = NEW.stage_id),
        'actor_kind',      COALESCE(NULLIF(who->>'kind', ''), 'automation'),
        'actor_label',     NULLIF(who->>'label', ''),
        'logged_by',       'database'
      )
    );
  EXCEPTION WHEN others THEN
    -- The log must never stop a lead from being moved.
    NULL;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.log_lead_stage_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_lead_stage_change() FROM anon, authenticated;

DROP TRIGGER IF EXISTS leads_log_stage_change ON public.leads;
CREATE TRIGGER leads_log_stage_change
  AFTER UPDATE OF stage_id ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.log_lead_stage_change();

NOTIFY pgrst, 'reload schema';
