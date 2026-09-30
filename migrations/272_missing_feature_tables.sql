-- Tables the app has always used but production never had. Each feature
-- quietly failed (saves errored or did nothing). Structures come from the
-- code that reads and writes them (and from 018 / 072, which were never
-- applied). All are read and written by the server only (supabaseAdmin), so
-- row-level security is on with no policies, like the other server tables.
-- Additive only: every table starts empty, so nothing visible changes until
-- someone uses the feature.

-- Admin → Trends: cached Google Trends results (072).
create table if not exists public.admin_kv_cache (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- The blog (/blog, the sitemap, Admin → Blog).
create table if not exists public.blog_posts (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  title            text not null default '',
  meta_title       text,
  meta_description text,
  og_image         text,
  excerpt          text,
  content          text not null default '',
  author_name      text,
  author_image     text,
  category         text,
  tags             text[] not null default '{}',
  featured_image   text,
  status           text not null default 'draft',
  noindex          boolean not null default false,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists blog_posts_published_idx on public.blog_posts (status, published_at desc);

-- Lead form builder: every saved version of a form (018).
create table if not exists public.marketing_form_revisions (
  id              uuid primary key default gen_random_uuid(),
  form_id         uuid not null references public.marketing_forms(id) on delete cascade,
  venue_id        uuid not null references public.venues(id) on delete cascade,
  definition_json jsonb not null,
  created_at      timestamptz not null default now()
);
create index if not exists marketing_form_revisions_form_id_idx on public.marketing_form_revisions (form_id, created_at desc);

-- Admin → SEO: per-page title, description and share image overrides.
create table if not exists public.page_seo (
  page_key       text primary key,
  title          text,
  description    text,
  og_image       text,
  og_title       text,
  og_description text,
  noindex        boolean not null default false,
  canonical      text,
  schema_json    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Help Center: article drafts from "suggest an article" and from articles
-- rated unhelpful, for review in Admin.
create table if not exists public.suggested_articles (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  body            text not null,
  source_question text,
  venue_id        uuid references public.venues(id) on delete set null,
  status          text not null default 'draft',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists suggested_articles_created_idx on public.suggested_articles (created_at desc);
create index if not exists suggested_articles_source_idx on public.suggested_articles (source_question, status);

-- Accounting sync (QuickBooks / FreshBooks): the connection (with its OAuth
-- tokens, so server-only) and a log of what was synced.
create table if not exists public.venue_integrations (
  id               uuid primary key default gen_random_uuid(),
  venue_id         uuid not null references public.venues(id) on delete cascade,
  provider         text not null,
  access_token     text,
  refresh_token    text,
  token_expires_at timestamptz,
  realm_id         text,
  account_id       text,
  company_name     text,
  connected_at     timestamptz,
  last_synced_at   timestamptz,
  sync_enabled     boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint venue_integrations_venue_provider_key unique (venue_id, provider)
);
create table if not exists public.venue_sync_log (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.venues(id) on delete cascade,
  provider      text not null,
  proposal_id   uuid references public.proposals(id) on delete set null,
  external_id   text,
  status        text not null,
  error_message text,
  synced_at     timestamptz not null default now()
);
create index if not exists venue_sync_log_venue_idx on public.venue_sync_log (venue_id, provider, synced_at desc);

-- Server-only.
alter table public.admin_kv_cache           enable row level security;
alter table public.blog_posts               enable row level security;
alter table public.marketing_form_revisions enable row level security;
alter table public.page_seo                 enable row level security;
alter table public.suggested_articles       enable row level security;
alter table public.venue_integrations       enable row level security;
alter table public.venue_sync_log           enable row level security;
revoke all on public.admin_kv_cache, public.blog_posts, public.marketing_form_revisions, public.page_seo,
  public.suggested_articles, public.venue_integrations, public.venue_sync_log from anon, authenticated;

notify pgrst, 'reload schema';
