-- 1. Venue email templates (Settings → Notifications). The code has always
--    read and saved venue_email_templates, but no migration created it, so
--    saves failed ("temporarily unavailable") and every email used the
--    defaults. Server-only, like the other venue tables (see 144).
create table if not exists public.venue_email_templates (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.venues(id) on delete cascade,
  type        text not null,
  subject     text,
  heading     text,
  body        text,
  button_text text,
  footer      text,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint venue_email_templates_venue_type_key unique (venue_id, type)
);
alter table public.venue_email_templates enable row level security;
revoke all on public.venue_email_templates from anon, authenticated;

-- 2. Invoices vs proposals. The couple's page guessed "invoice" from a missing
--    contract template, so a proposal with a freeform or AI-written contract
--    skipped the signature and went straight to payment. Mark invoices
--    explicitly; every existing invoice is a template-less document built by
--    the invoice builder (its content starts with an "Invoice" heading).
alter table public.proposals add column if not exists is_invoice boolean not null default false;
update public.proposals
  set is_invoice = true
  where template_id is null
    and content ~* '>\s*invoice\s*</h2>'
    and is_invoice = false;

notify pgrst, 'reload schema';
