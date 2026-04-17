-- ============================================================================
-- StoryPay: upgrade live Supabase project to modern schema
-- Project: brnxhsaakmhgwcthcapd (the one Railway points at)
--
-- RUN IN: Supabase Dashboard → SQL Editor (for the brnxhsaakmhgwcthcapd project)
--         https://supabase.com/dashboard/project/brnxhsaakmhgwcthcapd/sql/new
--
-- Idempotent: safe to run multiple times.
-- PRESERVES: existing venues (6 rows) and proposals (15 rows).
-- ADDS:      profiles table, leads table, missing columns on venues,
--            RLS policies, and the updated_at trigger on leads.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. profiles table (must exist before is_admin() references it)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  text,
  role       text NOT NULL DEFAULT 'venue_owner'
             CHECK (role IN ('venue_owner','admin')),
  created_at timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. Helper: is_admin() used by RLS policies
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2b. profiles RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Service role can insert profiles" ON public.profiles;
CREATE POLICY "Service role can insert profiles" ON public.profiles
  FOR INSERT WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO service_role, authenticated;
GRANT SELECT ON public.profiles TO anon;

-- ---------------------------------------------------------------------------
-- 3. venues: add missing columns from modern schema (non-destructive)
-- ---------------------------------------------------------------------------
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS owner_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS slug                 text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS description          text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS location_city        text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS location_state       text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS location_full        text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS lat                  numeric;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS lng                  numeric;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS venue_type           text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS capacity_min         int;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS capacity_max         int;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS price_min            int;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS price_max            int;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS indoor_outdoor       text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS features             jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS availability_notes   text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS cover_image_url      text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS gallery_images       jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS notification_email   text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS email_notifications  boolean DEFAULT true;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS onboarding_step      int DEFAULT 1;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS is_published         boolean DEFAULT false;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS login_token          uuid DEFAULT gen_random_uuid();
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS calendly_access_token text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS calendly_webhook_id  text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS calendly_user_uri    text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS calendly_org_uri     text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS calendly_connected   boolean DEFAULT false;

UPDATE public.venues
SET login_token = gen_random_uuid()
WHERE login_token IS NULL;

UPDATE public.venues
SET slug = lower(regexp_replace(regexp_replace(name, '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g'))
WHERE slug IS NULL AND name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS venues_slug_unique    ON public.venues (slug) WHERE slug IS NOT NULL;
CREATE INDEX        IF NOT EXISTS venues_login_token_idx ON public.venues (login_token);
CREATE INDEX        IF NOT EXISTS venues_owner_id_idx    ON public.venues (owner_id);

-- ---------------------------------------------------------------------------
-- 4. leads table (directory lead pipeline)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id         uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name             text NOT NULL,
  email            text NOT NULL,
  phone            text NOT NULL,
  wedding_date     date,
  guest_count      int,
  booking_timeline text,
  message          text,
  status           text NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new','contacted','tour_booked','proposal_sent','booked_wedding','not_interested')),
  notes            text,
  source           text NOT NULL DEFAULT 'directory',
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_venue_id_idx   ON public.leads (venue_id);
CREATE INDEX IF NOT EXISTS leads_status_idx     ON public.leads (status);
CREATE INDEX IF NOT EXISTS leads_created_at_idx ON public.leads (created_at DESC);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can submit a lead" ON public.leads;
CREATE POLICY "Anyone can submit a lead" ON public.leads
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Owners can read leads for their venue" ON public.leads;
CREATE POLICY "Owners can read leads for their venue" ON public.leads
  FOR SELECT USING (
    venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "Owners can update leads for their venue" ON public.leads;
CREATE POLICY "Owners can update leads for their venue" ON public.leads
  FOR UPDATE USING (
    venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can read all leads" ON public.leads;
CREATE POLICY "Admins can read all leads" ON public.leads
  FOR SELECT USING (is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO service_role, authenticated;
GRANT SELECT, INSERT ON public.leads TO anon;

-- ---------------------------------------------------------------------------
-- 5. updated_at trigger for leads
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_updated_at ON public.leads;
CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;

-- ---------------------------------------------------------------------------
-- 6. Tell PostgREST to reload (must be OUTSIDE the transaction)
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
