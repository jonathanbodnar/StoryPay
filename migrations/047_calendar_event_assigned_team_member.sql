-- 047_calendar_event_assigned_team_member.sql
-- Calendar events can optionally be assigned to an internal team member so
-- venues can see, at a glance, who is running a tour / call / meeting.
-- The relationship is a soft link: deleting the team member just clears the
-- assignment (ON DELETE SET NULL). The column is nullable because most
-- existing events (and every past event) were created without an assignee.

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS assigned_team_member_id uuid
    REFERENCES public.venue_team_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS calendar_events_assigned_team_member_id_idx
  ON public.calendar_events (assigned_team_member_id);

NOTIFY pgrst, 'reload schema';
