-- ============================================================================
-- 006_customer_crm_tables.sql
--
-- Adds the remaining CRM tables used by the Customer detail page on
-- app.storyvenue.com (notes, tasks, files, activity, spaces, calendar events).
--
-- Run ONCE against the LIVE Supabase project (brnxhsaakmhgwcthcapd).
-- Fully idempotent — safe to re-run.
--
-- Fixes the "Could not find the table 'public.customer_notes' in the schema
-- cache" error when clicking Add Note on a customer.
-- ============================================================================

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Generic updated_at trigger function (reused across tables) ──────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ── Enums (guarded with DO blocks so the migration is idempotent) ───────────
DO $$ BEGIN
  CREATE TYPE public.calendar_event_type AS ENUM
    ('wedding','reception','tour','tasting','meeting','rehearsal','hold','blocked','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.calendar_event_status AS ENUM
    ('tentative','confirmed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.customer_file_type AS ENUM
    ('contract','floor_plan','vendor_agreement','insurance','photo','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.customer_file_status AS ENUM
    ('pending','received','approved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── venue_spaces ────────────────────────────────────────────────────────────
-- Bookable physical spaces within a venue (e.g. "Barn", "Garden", "Patio").
CREATE TABLE IF NOT EXISTS public.venue_spaces (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  color       text        NOT NULL DEFAULT '#6366f1',
  capacity    integer,
  description text,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_spaces_venue_id_idx ON public.venue_spaces (venue_id);

-- Now that venue_spaces exists, wire up the FK from venue_customers.
DO $$ BEGIN
  ALTER TABLE public.venue_customers
    ADD CONSTRAINT venue_customers_wedding_space_fk
      FOREIGN KEY (wedding_space_id) REFERENCES public.venue_spaces(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── calendar_events ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id                uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id          uuid                    NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  space_id          uuid                             REFERENCES public.venue_spaces(id) ON DELETE SET NULL,
  customer_email    text,
  title             text                    NOT NULL,
  event_type        public.calendar_event_type   NOT NULL DEFAULT 'other',
  status            public.calendar_event_status NOT NULL DEFAULT 'confirmed',
  start_at          timestamptz             NOT NULL,
  end_at            timestamptz             NOT NULL,
  all_day           boolean                 NOT NULL DEFAULT false,
  proposal_id       uuid,
  notes             text,
  override_conflict boolean                 NOT NULL DEFAULT false,
  created_at        timestamptz             NOT NULL DEFAULT now(),
  updated_at        timestamptz             NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calendar_events_venue_id_idx  ON public.calendar_events (venue_id);
CREATE INDEX IF NOT EXISTS calendar_events_space_id_idx  ON public.calendar_events (space_id);
CREATE INDEX IF NOT EXISTS calendar_events_start_at_idx  ON public.calendar_events (start_at);

DROP TRIGGER IF EXISTS trg_calendar_events_updated_at ON public.calendar_events;
CREATE TRIGGER trg_calendar_events_updated_at
  BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── customer_notes ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_notes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  customer_id uuid        NOT NULL REFERENCES public.venue_customers(id) ON DELETE CASCADE,
  content     text        NOT NULL,
  author_name text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_notes_customer_id_idx ON public.customer_notes (customer_id);

-- ── customer_tasks ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_tasks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  customer_id  uuid        NOT NULL REFERENCES public.venue_customers(id) ON DELETE CASCADE,
  title        text        NOT NULL,
  due_date     date,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_tasks_customer_id_idx ON public.customer_tasks (customer_id);

-- ── customer_files ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_files (
  id           uuid                          PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     uuid                          NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  customer_id  uuid                          NOT NULL REFERENCES public.venue_customers(id) ON DELETE CASCADE,
  filename     text                          NOT NULL,
  storage_path text                          NOT NULL,
  file_size    integer,
  file_type    public.customer_file_type     NOT NULL DEFAULT 'other',
  file_status  public.customer_file_status   NOT NULL DEFAULT 'pending',
  uploaded_by  text,
  created_at   timestamptz                   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_files_customer_id_idx ON public.customer_files (customer_id);

-- ── customer_activity ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_activity (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  customer_id   uuid        NOT NULL REFERENCES public.venue_customers(id) ON DELETE CASCADE,
  activity_type text        NOT NULL,
  title         text        NOT NULL,
  description   text,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_activity_customer_id_idx ON public.customer_activity (customer_id);
CREATE INDEX IF NOT EXISTS customer_activity_created_at_idx  ON public.customer_activity (created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- The server always uses the service_role key, which bypasses RLS. These
-- policies only matter for direct-from-client access, but we enable RLS
-- everywhere so nothing leaks if the anon key is ever used against these tables.
ALTER TABLE public.venue_spaces       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_notes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_tasks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_files     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_activity  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'venue_spaces','calendar_events','customer_notes',
    'customer_tasks','customer_files','customer_activity'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Owners can read %1$I" ON public.%1$I;',  t);
    EXECUTE format('DROP POLICY IF EXISTS "Owners can write %1$I" ON public.%1$I;', t);

    EXECUTE format($f$
      CREATE POLICY "Owners can read %1$I" ON public.%1$I
        FOR SELECT USING (
          venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
        );
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY "Owners can write %1$I" ON public.%1$I
        FOR ALL USING (
          venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
        ) WITH CHECK (
          venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
        );
    $f$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.venue_spaces,
  public.calendar_events,
  public.customer_notes,
  public.customer_tasks,
  public.customer_files,
  public.customer_activity
TO service_role, authenticated;

-- ── Tell PostgREST to refresh its schema cache so the new tables show up
--    immediately in the supabase-js client. ───────────────────────────────────
NOTIFY pgrst, 'reload schema';
