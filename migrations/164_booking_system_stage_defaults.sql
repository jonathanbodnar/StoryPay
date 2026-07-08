-- Adds per-stage "published default" templates for the Speed to Lead System
-- (src/app/dashboard/listing/booking-system/page.tsx).
--
-- The Demo Venue is the master template for the Booking System. Its live
-- configuration for Stage 2 ("phase2" — 14-Day Sequence), Stage 3 ("phase4" —
-- Booked Tour → Toured) and Stage 4 ("phase5" — Wedding Day → Welcomed) can be
-- explicitly "Saved as Default" (Demo-Venue-only, enforced server-side in
-- src/app/api/listing/booking-system/stage-default/route.ts), and any venue
-- can "Reset to Default" to pull down the latest published copy for a stage.
--
-- Stage 1 (Guide Delivery / phase1) is just two on/off toggles plus a single
-- fixed email/SMS body each (no StepConfig[] step sequence to reset), so it
-- has no row/stage_key here — see route.ts / page.tsx for details.
--
-- Reset only ever replaces a venue's automation *step content*; it never
-- touches that venue's on/off toggle (marketing_automations.status) or any
-- other trigger wiring beyond self-healing on first creation.

create table if not exists public.booking_system_stage_defaults (
  id uuid primary key default gen_random_uuid(),
  stage_key text not null unique,  -- 'phase2' | 'phase4' | 'phase5'
  steps_json jsonb not null,       -- StepConfig[] (see route.ts)
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.booking_system_stage_defaults enable row level security;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='booking_system_stage_defaults' AND policyname='service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON public.booking_system_stage_defaults
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- One-time seed: publish the Demo Venue's CURRENT live automation steps for
-- phase2/phase4/phase5 as the initial defaults. Reads directly from
-- marketing_automation_steps (rather than hardcoding copy) so whatever the
-- Demo Venue actually has live right now becomes the canonical template —
-- consistent with the pattern in migrations/162.
--
-- Idempotent: ON CONFLICT (stage_key) DO NOTHING, so re-running this
-- migration never clobbers a default that has since been intentionally
-- republished via the "Save as Default" UI action.
do $$
declare
  v_venue_id uuid;
  v_stage record;
  v_automation_id uuid;
  v_steps jsonb;
begin
  select id into v_venue_id from public.venues where name = 'Demo Venue' limit 1;

  if v_venue_id is null then
    raise notice 'Demo Venue not found — skipping booking_system_stage_defaults seed.';
  else
    for v_stage in
      select * from (values
        ('phase2', 'Speed to Lead — Booking System'),
        ('phase4', 'Booked Tour Sequence — Booking System'),
        ('phase5', 'Booked Wedding Sequence — Booking System')
      ) as t(stage_key, automation_name)
    loop
      v_automation_id := null;
      v_steps := null;

      select id into v_automation_id from public.marketing_automations
        where venue_id = v_venue_id and name = v_stage.automation_name
        limit 1;

      if v_automation_id is not null then
        select jsonb_agg(jsonb_build_object(
            'step_order',    s.step_order,
            'step_type',     s.step_type,
            'label',         coalesce(s.config_json->>'label', ''),
            'body',          coalesce(s.config_json->>'body', ''),
            'subject',       coalesce(s.config_json->>'subject', ''),
            'preview_text',  coalesce(s.config_json->>'preview_text', ''),
            'image_url',     coalesce(s.config_json->>'image_url', ''),
            'image_link',    coalesce(s.config_json->>'image_link', ''),
            'button_text',   coalesce(s.config_json->>'button_text', ''),
            'button_link',   coalesce(s.config_json->>'button_link', ''),
            'delay_minutes', coalesce((s.config_json->>'delay_minutes')::int, 0)
          ) order by s.step_order)
          into v_steps
          from public.marketing_automation_steps s
          where s.automation_id = v_automation_id;

        if v_steps is not null then
          insert into public.booking_system_stage_defaults (stage_key, steps_json, updated_by)
          values (v_stage.stage_key, v_steps, 'migration_164_seed_demo_venue')
          on conflict (stage_key) do nothing;

          raise notice 'Seeded default for stage % from automation %', v_stage.stage_key, v_automation_id;
        else
          raise notice 'No steps found for stage % (automation %) — skipping seed for this stage.', v_stage.stage_key, v_automation_id;
        end if;
      else
        raise notice 'No automation "%" found for Demo Venue — skipping seed for stage %.', v_stage.automation_name, v_stage.stage_key;
      end if;
    end loop;
  end if;
end $$;

NOTIFY pgrst, 'reload schema';
