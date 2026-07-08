-- Extends the "Save as Default" / "Reset to Default" feature (migration 164)
-- to Stage 1 (Guide Delivery / phase1). Unlike phase2/phase4/phase5, phase1
-- has no marketing_automations / StepConfig[] step sequence — it's just two
-- on/off toggles plus one fixed email body and one fixed SMS body
-- (`venues.booking_guide_email_body` / `venues.booking_guide_sms_body`, with
-- in-code fallback defaults DEFAULT_GUIDE_EMAIL_BODY / DEFAULT_GUIDE_SMS_BODY
-- in src/lib/marketing-email-worker.ts).
--
-- So its `booking_system_stage_defaults.steps_json` row is NOT a step array
-- but a small JSON object: { "guideEmailBody": "...", "guideSmsBody": "..." }
-- (steps_json is jsonb, so this shape is fine — no schema change needed).
-- See src/app/api/listing/booking-system/stage-default/route.ts for how
-- publish/reset handle stageKey = 'phase1' — reset writes straight to the
-- resetting venue's `venues` row, never touching
-- booking_guide_email_enabled / booking_guide_sms_enabled.
--
-- One-time seed: reads the Demo Venue's CURRENT LIVE guide-delivery copy
-- (falling back to the in-code defaults if the venue has never customized
-- them / the columns are null) and publishes it as the initial phase1
-- default. Idempotent: ON CONFLICT (stage_key) DO NOTHING, same pattern as
-- migration 164 — re-running this never clobbers a default that's since been
-- intentionally republished via "Save as Default".

do $$
declare
  v_venue_id uuid;
  v_email_body text;
  v_sms_body text;
  -- Kept in sync with DEFAULT_GUIDE_EMAIL_BODY / DEFAULT_GUIDE_SMS_BODY in
  -- src/lib/marketing-email-worker.ts — used only as a fallback if the Demo
  -- Venue's own columns are null/empty.
  v_default_email_body text := $DEFAULT$Hi {{first_name}},

Thanks for your interest in {{venue_name}}! Your pricing guide is ready — click below to view it.

{{pricing_guide_url}}

We'd love to show you around. Reply to this email or visit the link above to learn more.

– {{venue_name}}$DEFAULT$;
  v_default_sms_body text := 'Hi {{first_name}}! Thanks for your interest in {{venue_name}}. Here''s your pricing guide: {{pricing_guide_url}} — Reply to ask any questions!';
begin
  select id into v_venue_id from public.venues where name = 'Demo Venue' limit 1;

  if v_venue_id is null then
    raise notice 'Demo Venue not found — skipping phase1 stage-default seed.';
  else
    select booking_guide_email_body, booking_guide_sms_body
      into v_email_body, v_sms_body
      from public.venues
      where id = v_venue_id;

    insert into public.booking_system_stage_defaults (stage_key, steps_json, updated_by)
    values (
      'phase1',
      jsonb_build_object(
        'guideEmailBody', coalesce(nullif(v_email_body, ''), v_default_email_body),
        'guideSmsBody',   coalesce(nullif(v_sms_body, ''), v_default_sms_body)
      ),
      'migration_165_seed_demo_venue'
    )
    on conflict (stage_key) do nothing;

    raise notice 'Seeded phase1 (guide delivery) stage default for venue %', v_venue_id;
  end if;
end $$;

NOTIFY pgrst, 'reload schema';
