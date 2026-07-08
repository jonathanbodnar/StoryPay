-- Backfill: fix Phase 4 (Booked Tour) and Phase 5 (Booked Wedding) automation
-- triggers on the Speed to Lead System page.
--
-- These automations were originally created with trigger_type = 'tag_added'
-- and an empty trigger_config, which matched ANY tag being added to a lead
-- (not a specific pipeline-stage move). This backfill switches them to the
-- correct trigger_type = 'stage_changed', pointed at each venue's own
-- default/locked pipeline stage ("Tour Booked" / "Wedding Booked").
--
-- The application code (src/app/api/listing/booking-system/route.ts) now
-- self-heals this trigger_config on every save, so this migration is a
-- one-time correction for any automation rows that already existed before
-- that fix shipped. Already applied directly via the Supabase SQL editor on
-- 2026-07-08; recorded here for history / re-runnability (idempotent).

update public.marketing_automations ma
set
  trigger_type = 'stage_changed',
  trigger_config = jsonb_build_object('to_stage_ids', jsonb_build_array(lps.id))
from public.lead_pipelines lp
join public.lead_pipeline_stages lps
  on lps.pipeline_id = lp.id and lps.name = 'Tour Booked'
where ma.name = 'Booked Tour Sequence — Booking System'
  and ma.venue_id = lp.venue_id
  and lp.is_default = true;

update public.marketing_automations ma
set
  trigger_type = 'stage_changed',
  trigger_config = jsonb_build_object('to_stage_ids', jsonb_build_array(lps.id))
from public.lead_pipelines lp
join public.lead_pipeline_stages lps
  on lps.pipeline_id = lp.id and lps.name = 'Wedding Booked'
where ma.name = 'Booked Wedding Sequence — Booking System'
  and ma.venue_id = lp.venue_id
  and lp.is_default = true;
