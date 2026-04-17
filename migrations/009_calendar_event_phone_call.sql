-- Add "phone call" as a first-class calendar event type (alongside tour, meeting, etc.)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.typname = 'calendar_event_type'
      AND e.enumlabel = 'phone_call'
  ) THEN
    ALTER TYPE public.calendar_event_type ADD VALUE 'phone_call';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
