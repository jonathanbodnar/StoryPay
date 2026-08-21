-- Blocklist of GHL contact IDs that have been explicitly deleted from StoryVenue.
-- The GHL contacts sync cron skips any contact whose (venue_id, ghl_contact_id)
-- appears here, preventing deleted contacts from re-appearing after a sync run.
create table if not exists ghl_deleted_contacts (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid not null references venues(id) on delete cascade,
  ghl_contact_id text not null,
  deleted_at     timestamptz not null default now(),
  unique (venue_id, ghl_contact_id)
);

create index if not exists ghl_deleted_contacts_venue_idx
  on ghl_deleted_contacts (venue_id);
