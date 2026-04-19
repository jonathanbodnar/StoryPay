-- Per-venue appointment reminder schedule + queued sends relative to calendar_events.start_at
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS appointment_reminders_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS appointment_reminder_offsets jsonb NOT NULL DEFAULT '[
    {"d":1,"h":0,"m":0},
    {"d":0,"h":1,"m":0},
    {"d":0,"h":0,"m":10}
  ]'::jsonb;

COMMENT ON COLUMN public.venues.appointment_reminders_enabled IS 'When true, schedule customer email reminders before appointments (non-recurring events with customer_email).';
COMMENT ON COLUMN public.venues.appointment_reminder_offsets IS 'Array (max 5) of {d,h,m} = send this long before start_at.';

CREATE TABLE IF NOT EXISTS public.calendar_event_reminders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_event_id  uuid NOT NULL REFERENCES public.calendar_events(id) ON DELETE CASCADE,
  venue_id           uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  reminder_index     smallint NOT NULL,
  offset_days        integer NOT NULL DEFAULT 0,
  offset_hours       integer NOT NULL DEFAULT 0,
  offset_minutes     integer NOT NULL DEFAULT 0,
  send_at            timestamptz NOT NULL,
  sent_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_event_reminders_index_chk CHECK (reminder_index >= 0 AND reminder_index < 5),
  CONSTRAINT calendar_event_reminders_offset_nonneg CHECK (
    offset_days >= 0 AND offset_hours >= 0 AND offset_minutes >= 0
  ),
  CONSTRAINT calendar_event_reminders_event_idx_uidx UNIQUE (calendar_event_id, reminder_index)
);

CREATE INDEX IF NOT EXISTS calendar_event_reminders_due_idx
  ON public.calendar_event_reminders (send_at)
  WHERE sent_at IS NULL;

CREATE INDEX IF NOT EXISTS calendar_event_reminders_venue_id_idx ON public.calendar_event_reminders (venue_id);

NOTIFY pgrst, 'reload schema';
