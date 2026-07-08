-- One-time data seed: replaces the Demo Venue's Phase 2 ("Guide Delivered →
-- 14-Day Sequence") automation steps with the canonical 7-touch SMS copy.
--
-- The Demo Venue already had 2 pre-existing placeholder steps (an SMS +
-- email using an old {{coordinator_name}} tag) saved from before this
-- feature's default-copy fallback shipped (migrations/161 / commit 113e321).
-- Because that fallback only ever applies when zero steps exist yet (so real
-- venues' customizations are never silently overwritten), the Demo Venue
-- needed this explicit one-time reseed instead of picking up the new default
-- automatically.
--
-- Already applied directly via the Supabase SQL editor on 2026-07-08;
-- recorded here for history / re-runnability (idempotent — safe to re-run,
-- it always deletes+reinserts this automation's steps for the Demo Venue).

do $$
declare
  v_venue_id uuid;
  v_automation_id uuid;
begin
  select id into v_venue_id from public.venues where name = 'Demo Venue' limit 1;
  if v_venue_id is null then
    raise exception 'Demo Venue not found — check the venue name.';
  end if;

  select id into v_automation_id from public.marketing_automations
    where venue_id = v_venue_id and name = 'Speed to Lead — Booking System';

  if v_automation_id is null then
    insert into public.marketing_automations (venue_id, name, status, trigger_type, trigger_config)
    values (v_venue_id, 'Speed to Lead — Booking System', 'active', 'form_submitted', '{}'::jsonb)
    returning id into v_automation_id;
  else
    update public.marketing_automations set status = 'active', trigger_type = 'form_submitted' where id = v_automation_id;
  end if;

  delete from public.marketing_automation_steps where automation_id = v_automation_id;

  insert into public.marketing_automation_steps (automation_id, step_order, step_type, config_json) values
  (v_automation_id, 0, 'delay', jsonb_build_object('label','Wait 1 day','delay_minutes',1440)),
  (v_automation_id, 1, 'send_sms', jsonb_build_object('label','Day 1','delay_minutes',0,'body',
    'Hi {{first_name}}! It''s {{owner_name}} over at {{venue_name}}, just making sure the pricing and availability guide landed in your inbox ok? 😊 And do you have a date in mind yet? Happy to peek at the calendar and see if it''s still open for you!')),
  (v_automation_id, 2, 'delay', jsonb_build_object('label','Wait 1 day','delay_minutes',1440)),
  (v_automation_id, 3, 'send_sms', jsonb_build_object('label','Day 2','delay_minutes',0,'body',
    'Hey {{first_name}}, this is {{owner_name}} from {{venue_name}}. Saw you downloaded our guide! Just making sure it reached you ok? And do you have a date picked out yet? Happy to check if it''s still open for you.')),
  (v_automation_id, 4, 'delay', jsonb_build_object('label','Wait 1 day','delay_minutes',1440)),
  (v_automation_id, 5, 'send_sms', jsonb_build_object('label','Day 3','delay_minutes',0,'body',
    'Hi {{first_name}}! Totally get that looking at venues can feel like a lot. If it''s easier, just tell me the one thing you''re trying to figure out right now and I''ll help with that.')),
  (v_automation_id, 6, 'delay', jsonb_build_object('label','Wait 2 days','delay_minutes',2880)),
  (v_automation_id, 7, 'send_sms', jsonb_build_object('label','Day 5','delay_minutes',0,'body',
    'Hi {{first_name}}! Okay, fun question. 😊 Are you picturing spring blooms, summer sunsets, or cozy fall vibes for your wedding?')),
  (v_automation_id, 8, 'delay', jsonb_build_object('label','Wait 2 days','delay_minutes',2880)),
  (v_automation_id, 9, 'send_sms', jsonb_build_object('label','Day 7','delay_minutes',0,'body',
    'Hey {{first_name}}! Feels like there might be a few things easier to just talk through than text back and forth. Want to hop on a quick 5-min call? Whenever''s good for you, no pressure at all.')),
  (v_automation_id, 10, 'delay', jsonb_build_object('label','Wait 3 days','delay_minutes',4320)),
  (v_automation_id, 11, 'send_sms', jsonb_build_object('label','Day 10','delay_minutes',0,'body',
    'Hey {{first_name}}, there''s so much that goes into planning your wedding day. 😊 Please don''t feel like you have to figure it all out by yourself. I''d love to help however I can.')),
  (v_automation_id, 12, 'delay', jsonb_build_object('label','Wait 4 days','delay_minutes',5760)),
  (v_automation_id, 13, 'send_sms', jsonb_build_object('label','Day 14','delay_minutes',0,'body',
    'Hi {{first_name}}! When you reached out about {{venue_name}}, I didn''t want to just send a guide and disappear on you. So I wanted to check in one more time, is there anything you''re still wondering about that I can help with?'));

  raise notice 'Seeded 14-day sequence for automation %', v_automation_id;
end $$;
