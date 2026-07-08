-- Retires the old "Nurture Sequence" (Phase 3) automation, which was removed
-- from the Speed to Lead System page's UI. Venues that want that kind of
-- standalone educational/nurture content can build it as its own Email
-- Campaign instead — this keeps the Speed to Lead page focused on the core
-- inquiry → tour → wedding funnel.
--
-- Pauses (does not delete) any existing "Nurture Sequence — Booking System"
-- automation rows across all venues so nothing keeps silently enrolling
-- leads now that the UI toggle controlling it no longer exists. Steps are
-- left intact in case this is ever revisited.
--
-- Already applied directly via the Supabase SQL editor on 2026-07-08;
-- recorded here for history / re-runnability (idempotent).

update public.marketing_automations
set status = 'paused'
where name = 'Nurture Sequence — Booking System'
  and status <> 'paused';
