-- 051: let venue owners create a contact without placing it in any pipeline.
-- A lead with `excluded_from_pipeline = true` is hidden from the Kanban and
-- skipped by the kanban reconciler, but still appears on the Contacts page
-- (via venue_customers) so it remains searchable and editable.

alter table if exists public.leads
  add column if not exists excluded_from_pipeline boolean not null default false;

create index if not exists idx_leads_excluded_from_pipeline
  on public.leads (venue_id, excluded_from_pipeline);

notify pgrst, 'reload schema';
