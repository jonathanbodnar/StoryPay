-- 211: Venue Concierge — general (contact-independent) relationship channel
-- between a venue's owner/team and the StoryVenue concierge team.
--
-- One implicit thread per venue. Isolated from the contact-scoped
-- conversation_* schema on purpose (keeps that hot path untouched). Gated in
-- the app by the existing `directory_addon_concierge` entitlement.

create table if not exists venue_concierge_messages (
  id                     uuid primary key default gen_random_uuid(),
  venue_id               uuid not null references venues(id) on delete cascade,
  sender_kind            text not null check (sender_kind in ('venue','concierge')),
  sender_support_user_id uuid references support_team_members(id) on delete set null,
  sender_label           text,
  body                   text not null,
  created_at             timestamptz not null default now()
);

create index if not exists venue_concierge_messages_venue_created_idx
  on venue_concierge_messages (venue_id, created_at);

-- Per-viewer read state. reader_ref: 'venue' (owner/any team member share one
-- venue-side read cursor for MVP) or 'concierge:<support_user_id>'.
create table if not exists venue_concierge_reads (
  venue_id     uuid not null references venues(id) on delete cascade,
  reader_ref   text not null,
  last_read_at timestamptz not null default now(),
  primary key (venue_id, reader_ref)
);
