/**
 * Migration 153 — consolidated catch-up
 *
 * Applies all infrastructure that was built in code but never landed in
 * production: directory plans, billing columns, onboarding state, addon flags,
 * analytics events, and deferred-downgrade tracking. Also seeds the
 * Bride Booking System plan (the paid plan new signups trial into) and the
 * Legacy Free plan (for grandfathering existing venues).
 *
 * Fully idempotent — safe to re-run.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMasterAdminOnly } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const STEPS: { label: string; sql: string }[] = [
  // ── 034 directory_plans table ─────────────────────────────────────────────
  {
    label: '034a: directory_feature_definitions',
    sql: `
      CREATE TABLE IF NOT EXISTS public.directory_feature_definitions (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        feature_key text        NOT NULL UNIQUE,
        label       text        NOT NULL,
        description text,
        category    text,
        sort_order  int         NOT NULL DEFAULT 0,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE public.directory_feature_definitions DISABLE ROW LEVEL SECURITY;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.directory_feature_definitions TO service_role;
      INSERT INTO public.directory_feature_definitions (feature_key, label, description, category, sort_order) VALUES
        ('dashboard_home','Dashboard home','Main dashboard','Core',10),
        ('contacts','Contacts','Contact list & CRM','CRM',20),
        ('leads','Leads','Lead inbox & pipelines','CRM',30),
        ('calendar','Calendar','Calendar & events','Operations',40),
        ('conversations','Conversations','Messaging','CRM',50),
        ('reports','Reports','Analytics & reports','Insights',60),
        ('payments','Payments','Proposals, invoices, payments','Revenue',70),
        ('marketing','Marketing','Forms, email, campaigns','Growth',80),
        ('listing','Venue listing','Public listing & directory tools','Listing',90),
        ('settings','Settings','Venue settings & team','Core',100),
        ('ai_assistant','Ask AI','AI assistant','Core',110)
      ON CONFLICT (feature_key) DO NOTHING;
    `,
  },
  {
    label: '034b: directory_plans table',
    sql: `
      CREATE TABLE IF NOT EXISTS public.directory_plans (
        id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        name                text        NOT NULL,
        slug                text        NOT NULL UNIQUE,
        description         text,
        sort_order          int         NOT NULL DEFAULT 0,
        is_default          boolean     NOT NULL DEFAULT false,
        price_monthly_cents int,
        stripe_price_id     text,
        feature_flags       jsonb       NOT NULL DEFAULT '{}'::jsonb,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS directory_plans_sort_idx ON public.directory_plans (sort_order, name);
      ALTER TABLE public.directory_plans DISABLE ROW LEVEL SECURITY;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.directory_plans TO service_role;
    `,
  },
  {
    label: '034c: directory_plan_id on venues',
    sql: `
      ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS directory_plan_id uuid;
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'venues_directory_plan_id_fkey'
        ) THEN
          ALTER TABLE public.venues ADD CONSTRAINT venues_directory_plan_id_fkey
            FOREIGN KEY (directory_plan_id) REFERENCES public.directory_plans(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `,
  },
  // ── 035 billing columns ───────────────────────────────────────────────────
  {
    label: '035: directory billing columns on venues + platform_billing_events',
    sql: `
      ALTER TABLE public.directory_plans ADD COLUMN IF NOT EXISTS fortis_merchant_id text;
      ALTER TABLE public.venues
        ADD COLUMN IF NOT EXISTS directory_subscription_status text NOT NULL DEFAULT 'none',
        ADD COLUMN IF NOT EXISTS directory_subscription_external_id text;
      CREATE TABLE IF NOT EXISTS public.platform_billing_events (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        venue_id           uuid REFERENCES public.venues(id) ON DELETE SET NULL,
        directory_plan_id  uuid REFERENCES public.directory_plans(id) ON DELETE SET NULL,
        amount_cents       int         NOT NULL,
        currency           text        NOT NULL DEFAULT 'usd',
        fortis_merchant_id text,
        external_event_id  text,
        event_type         text        NOT NULL,
        occurred_at        timestamptz NOT NULL DEFAULT now(),
        metadata           jsonb       NOT NULL DEFAULT '{}'::jsonb,
        created_at         timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS platform_billing_events_occurred_idx ON public.platform_billing_events (occurred_at DESC);
      CREATE INDEX IF NOT EXISTS platform_billing_events_venue_idx    ON public.platform_billing_events (venue_id);
      ALTER TABLE public.platform_billing_events DISABLE ROW LEVEL SECURITY;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_billing_events TO service_role;
    `,
  },
  // ── 036 nav_permissions on plans ─────────────────────────────────────────
  {
    label: '036: nav_permissions on directory_plans',
    sql: `ALTER TABLE public.directory_plans ADD COLUMN IF NOT EXISTS nav_permissions jsonb NOT NULL DEFAULT '{}'::jsonb;`,
  },
  // ── 037 platform LunarPay customer ────────────────────────────────────────
  {
    label: '037: platform_lunarpay_customer_id on venues',
    sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS platform_lunarpay_customer_id text;`,
  },
  // ── 092 addon flags ───────────────────────────────────────────────────────
  {
    label: '092: addon flags on venues',
    sql: `
      ALTER TABLE public.venues
        ADD COLUMN IF NOT EXISTS directory_addon_verified  boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS directory_addon_sponsored boolean NOT NULL DEFAULT false;
    `,
  },
  // ── 093 trial columns ─────────────────────────────────────────────────────
  {
    label: '093: trial columns on directory_plans + venues',
    sql: `
      ALTER TABLE public.directory_plans
        ADD COLUMN IF NOT EXISTS trial_period_value integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS trial_period_unit  text    NOT NULL DEFAULT 'none';
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'directory_plans_trial_period_unit_check') THEN
          ALTER TABLE public.directory_plans ADD CONSTRAINT directory_plans_trial_period_unit_check
            CHECK (trial_period_unit IN ('none','days','weeks','months','years','forever'));
        END IF;
      END $$;
      ALTER TABLE public.venues
        ADD COLUMN IF NOT EXISTS directory_trial_started_at  timestamptz,
        ADD COLUMN IF NOT EXISTS directory_trial_ends_at     timestamptz,
        ADD COLUMN IF NOT EXISTS directory_trial_is_forever  boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS directory_trial_plan_id     uuid,
        ADD COLUMN IF NOT EXISTS directory_trial_consumed    boolean NOT NULL DEFAULT false;
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venues_directory_trial_plan_id_fkey') THEN
          ALTER TABLE public.venues ADD CONSTRAINT venues_directory_trial_plan_id_fkey
            FOREIGN KEY (directory_trial_plan_id) REFERENCES public.directory_plans(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `,
  },
  // ── 094-095 plan meta ─────────────────────────────────────────────────────
  {
    label: '094-095: plan visibility + highlight',
    sql: `
      ALTER TABLE public.directory_plans
        ADD COLUMN IF NOT EXISTS is_public       boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS highlight_label text;
    `,
  },
  // ── 096-097 concierge addon + addon price table ───────────────────────────
  {
    label: '096-097: concierge addon + addon prices',
    sql: `
      ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS directory_addon_concierge boolean NOT NULL DEFAULT false;
      CREATE TABLE IF NOT EXISTS public.platform_addon_prices (
        key         text        PRIMARY KEY,
        price_cents integer     NOT NULL DEFAULT 0,
        label       text        NOT NULL DEFAULT '',
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO public.platform_addon_prices (key, price_cents, label) VALUES
        ('verified',  1900, 'Verified Listing'),
        ('sponsored', 9900, 'Sponsored Listing'),
        ('concierge', 49900,'Venue Concierge')
      ON CONFLICT (key) DO NOTHING;
    `,
  },
  // ── 105 is_legacy on plans ────────────────────────────────────────────────
  {
    label: '105: is_legacy on directory_plans',
    sql: `ALTER TABLE public.directory_plans ADD COLUMN IF NOT EXISTS is_legacy boolean NOT NULL DEFAULT false;`,
  },
  // ── 143 analytics_events ─────────────────────────────────────────────────
  {
    label: '143: analytics_events table',
    sql: `
      CREATE TABLE IF NOT EXISTS public.analytics_events (
        id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        event      text        NOT NULL,
        kind       text        NOT NULL DEFAULT 'auto',
        venue_id   uuid        REFERENCES public.venues(id) ON DELETE SET NULL,
        user_email text,
        role       text,
        path       text,
        label      text,
        session_id text,
        properties jsonb
      );
      CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx ON public.analytics_events (created_at DESC);
      CREATE INDEX IF NOT EXISTS analytics_events_event_idx      ON public.analytics_events (event);
      CREATE INDEX IF NOT EXISTS analytics_events_kind_idx       ON public.analytics_events (kind);
      CREATE INDEX IF NOT EXISTS analytics_events_venue_id_idx   ON public.analytics_events (venue_id);
      CREATE INDEX IF NOT EXISTS analytics_events_path_idx       ON public.analytics_events (path);
      CREATE INDEX IF NOT EXISTS analytics_events_session_idx    ON public.analytics_events (session_id);
      CREATE INDEX IF NOT EXISTS analytics_events_milestone_idx  ON public.analytics_events (venue_id, event) WHERE kind = 'milestone';
      ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
    `,
  },
  // ── 148 onboarding columns ────────────────────────────────────────────────
  {
    label: '148: onboarding_completed_at + onboarding_last_step on venues',
    sql: `
      ALTER TABLE public.venues
        ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
        ADD COLUMN IF NOT EXISTS onboarding_last_step    smallint DEFAULT 0;
      CREATE INDEX IF NOT EXISTS venues_onboarding_incomplete_idx ON public.venues (onboarding_last_step)
        WHERE onboarding_completed_at IS NULL;
    `,
  },
  // ── 149 pricing guide edited_fields ──────────────────────────────────────
  {
    label: '149: edited_fields on venue_pricing_guides',
    sql: `ALTER TABLE public.venue_pricing_guides ADD COLUMN IF NOT EXISTS edited_fields jsonb NOT NULL DEFAULT '{}'::jsonb;`,
  },
  // ── 151 onboarding_activated_at ───────────────────────────────────────────
  {
    label: '151: onboarding_activated_at on venues',
    sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS onboarding_activated_at timestamptz;`,
  },
  // ── 152 deferred downgrade columns ───────────────────────────────────────
  {
    label: '152: deferred downgrade + dunning columns on venues',
    sql: `
      ALTER TABLE public.venues
        ADD COLUMN IF NOT EXISTS directory_downgrade_at           timestamptz,
        ADD COLUMN IF NOT EXISTS directory_trial_reminder_sent_at timestamptz,
        ADD COLUMN IF NOT EXISTS directory_dunning_started_at     timestamptz,
        ADD COLUMN IF NOT EXISTS directory_winback_nudged_at      timestamptz;
      CREATE INDEX IF NOT EXISTS idx_venues_directory_downgrade_at ON public.venues (directory_downgrade_at)
        WHERE directory_downgrade_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_venues_directory_trial_ends_at ON public.venues (directory_trial_ends_at)
        WHERE directory_trial_ends_at IS NOT NULL;
    `,
  },
  // ── Seed plans ────────────────────────────────────────────────────────────
  {
    label: 'seed: Bride Booking System plan (the paid plan new signups trial into)',
    sql: `
      INSERT INTO public.directory_plans
        (name, slug, description, sort_order, is_default, is_public, is_legacy,
         price_monthly_cents, trial_period_value, trial_period_unit, feature_flags)
      VALUES (
        'Bride Booking System',
        'bride-booking-system',
        'Full Bride Booking System — 14-day free trial, then $97/mo.',
        10, true, true, false,
        9700, 14, 'days',
        (SELECT COALESCE(jsonb_object_agg(feature_key, true), '{}') FROM public.directory_feature_definitions)
      )
      ON CONFLICT (slug) DO UPDATE SET
        price_monthly_cents  = EXCLUDED.price_monthly_cents,
        trial_period_value   = EXCLUDED.trial_period_value,
        trial_period_unit    = EXCLUDED.trial_period_unit,
        is_default           = EXCLUDED.is_default,
        is_legacy            = EXCLUDED.is_legacy,
        updated_at           = now();
    `,
  },
  {
    label: 'seed: Legacy Free plan (grandfathers existing free-listing venues)',
    sql: `
      INSERT INTO public.directory_plans
        (name, slug, description, sort_order, is_default, is_public, is_legacy,
         price_monthly_cents, feature_flags)
      VALUES (
        'Legacy Free',
        'legacy-free',
        'Grandfathered free listing — full dashboard access, no billing gate.',
        0, false, false, true,
        0,
        (SELECT COALESCE(jsonb_object_agg(feature_key, true), '{}') FROM public.directory_feature_definitions)
      )
      ON CONFLICT (slug) DO UPDATE SET
        is_legacy  = EXCLUDED.is_legacy,
        is_public  = EXCLUDED.is_public,
        updated_at = now();
    `,
  },
  // ── Stamp existing venues as legacy free ─────────────────────────────────
  {
    label: 'stamp: assign Legacy Free plan to all existing no-plan venues',
    sql: `
      UPDATE public.venues
      SET    directory_plan_id            = (SELECT id FROM public.directory_plans WHERE slug = 'legacy-free'),
             directory_subscription_status = 'none'
      WHERE  directory_plan_id IS NULL
        AND  is_demo IS NOT TRUE;
    `,
  },
];

export async function GET() {
  if (!(await verifyMasterAdminOnly())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: { label: string; ok: boolean; error?: string }[] = [];
  let anyError = false;

  for (const step of STEPS) {
    const { error } = await supabaseAdmin.rpc('exec_sql', { sql_query: step.sql });
    if (error) {
      // PGRST202 = the exec_sql RPC doesn't exist yet on this project.
      if (error.code === 'PGRST202') {
        return NextResponse.json(
          {
            error: 'exec_sql RPC not found. Apply migrations manually in the Supabase SQL editor.',
            steps: STEPS.map((s) => s.label),
          },
          { status: 500 },
        );
      }
      results.push({ label: step.label, ok: false, error: error.message });
      anyError = true;
    } else {
      results.push({ label: step.label, ok: true });
    }
  }

  return NextResponse.json({
    ok: !anyError,
    message: anyError ? 'Some steps failed — check results.' : 'Migration 153 applied successfully.',
    results,
  });
}
