-- Directory subscription plans + feature catalog for venue access control (future billing / gating).

BEGIN;

CREATE TABLE IF NOT EXISTS public.directory_feature_definitions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key text        NOT NULL UNIQUE,
  label       text        NOT NULL,
  description text,
  category    text,
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.directory_plans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text        NOT NULL,
  slug               text        NOT NULL UNIQUE,
  description        text,
  sort_order         int         NOT NULL DEFAULT 0,
  is_default         boolean     NOT NULL DEFAULT false,
  price_monthly_cents int,
  stripe_price_id    text,
  feature_flags      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS directory_plans_sort_idx ON public.directory_plans (sort_order, name);

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS directory_plan_id uuid REFERENCES public.directory_plans(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.venues.directory_plan_id IS 'Assigned directory / listing plan; NULL = legacy full access until assigned.';
COMMENT ON TABLE public.directory_plans IS 'Feature bundles for directory venues; feature_flags JSON keys match directory_feature_definitions.feature_key.';

ALTER TABLE public.directory_feature_definitions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.directory_plans DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.directory_feature_definitions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.directory_plans TO service_role;

-- Seed feature keys (idempotent)
INSERT INTO public.directory_feature_definitions (feature_key, label, description, category, sort_order) VALUES
  ('dashboard_home', 'Dashboard home', 'Main dashboard', 'Core', 10),
  ('contacts', 'Contacts', 'Contact list & CRM', 'CRM', 20),
  ('leads', 'Leads', 'Lead inbox & pipelines', 'CRM', 30),
  ('calendar', 'Calendar', 'Calendar & events', 'Operations', 40),
  ('conversations', 'Conversations', 'Messaging', 'CRM', 50),
  ('reports', 'Reports', 'Analytics & reports', 'Insights', 60),
  ('payments', 'Payments', 'Proposals, invoices, payments', 'Revenue', 70),
  ('marketing', 'Marketing', 'Forms, email, campaigns', 'Growth', 80),
  ('listing', 'Venue listing', 'Public listing & directory tools', 'Listing', 90),
  ('settings', 'Settings', 'Venue settings & team', 'Core', 100),
  ('ai_assistant', 'Ask AI', 'AI assistant', 'Core', 110)
ON CONFLICT (feature_key) DO NOTHING;

-- Default “full” plan (all flags true) for new assignments
INSERT INTO public.directory_plans (name, slug, description, sort_order, is_default, feature_flags)
SELECT
  'Full directory',
  'full-directory',
  'All features enabled',
  0,
  true,
  (SELECT COALESCE(jsonb_object_agg(feature_key, true), '{}'::jsonb) FROM public.directory_feature_definitions)
WHERE NOT EXISTS (SELECT 1 FROM public.directory_plans WHERE slug = 'full-directory');

COMMIT;

NOTIFY pgrst, 'reload schema';
