-- 266: The couple's Wedding Planner setup checklist (planner home)
--
-- The planner home shows a short "set up your Wedding Planner" checklist:
-- wedding date, venue, website, guest list, website invites, inspiration
-- board, budget, partner. Each item ticks itself when the app sees it done,
-- and a couple can tick or untick any item by hand. Those hand choices are
-- stored here as { "<item key>": true | false } and win over the automatic
-- check (lib/couple-planner-setup.ts).
--
-- Safe to re-run.

alter table public.couple_profiles
  add column if not exists planner_setup jsonb not null default '{}'::jsonb;
