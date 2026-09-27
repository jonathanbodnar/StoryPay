-- 260: AI agent access (MCP server at /api/mcp)
--
-- 1. mcp_api_keys  — one long-lived bearer key per agent (Jarvis, …). Only a
--    SHA-256 hash is stored; revoking = setting revoked_at.
-- 2. mcp_audit_log — every tool call an agent makes: who, which tool, how long,
--    ok/error. Never the result itself.
-- 3. mcp_readonly  — the database role the free-form `run_sql` tool runs as,
--    inside a READ ONLY transaction. It can SELECT every public table EXCEPT
--    columns whose names look like secrets (tokens, passwords, keys, hashes),
--    and can't see the two tables above at all. New tables and columns are
--    hidden until public.mcp_readonly_refresh_grants() grants them (the MCP
--    server calls it for new tables; pass true to re-scan every table's columns).
--
-- Additive and safe to re-run.

create table if not exists public.mcp_api_keys (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  key_hash     text not null unique,
  key_prefix   text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create table if not exists public.mcp_audit_log (
  id           bigserial primary key,
  key_name     text not null,
  tool         text not null,
  args         jsonb,
  ok           boolean not null,
  error        text,
  duration_ms  integer,
  result_bytes integer,
  created_at   timestamptz not null default now()
);
create index if not exists mcp_audit_log_created_idx on public.mcp_audit_log (created_at desc);

alter table public.mcp_api_keys enable row level security;
alter table public.mcp_audit_log enable row level security;

-- ── The read-only role ───────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mcp_readonly') then
    create role mcp_readonly nologin;
  end if;
  -- Row-level security would otherwise hide most rows from a new role. When
  -- BYPASSRLS can't be granted here, the refresh function adds a SELECT-only
  -- policy for this role on each RLS table instead.
  begin
    alter role mcp_readonly bypassrls;
  exception when insufficient_privilege then
    raise notice 'mcp_readonly: BYPASSRLS not grantable here; using per-table read policies';
  end;
  -- The app's own connection switches to this role (SET LOCAL ROLE) per query.
  begin
    execute format('grant mcp_readonly to %I', current_user);
  exception when others then
    raise notice 'mcp_readonly: grant to % failed: %', current_user, sqlerrm;
  end;
end $$;

grant usage on schema public to mcp_readonly;

create or replace function public.mcp_readonly_refresh_grants(p_all boolean default false)
returns integer
language plpgsql
as $$
declare
  t       record;
  cols    text;
  bypass  boolean;
  touched integer := 0;
begin
  select rolbypassrls into bypass from pg_roles where rolname = 'mcp_readonly';
  for t in
    select c.oid, c.relname, c.relkind, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
      and c.relname not in ('mcp_api_keys', 'mcp_audit_log')
      and (p_all or not has_any_column_privilege('mcp_readonly', c.oid, 'SELECT'))
  loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
    from pg_attribute a
    where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
      and a.attname !~* '(token|secret|passw|api_?key|private_?key|signing_?key|access_?key|hash|salt|otp|credential|encrypted|cvv|card_number)';

    execute format('revoke all on public.%I from mcp_readonly', t.relname);
    if cols is not null then
      execute format('grant select (%s) on public.%I to mcp_readonly', cols, t.relname);
    end if;

    if t.relkind in ('r', 'p') and t.relrowsecurity and not coalesce(bypass, false)
       and not exists (select 1 from pg_policy where polrelid = t.oid and polname = 'mcp_readonly_read') then
      execute format('create policy mcp_readonly_read on public.%I for select to mcp_readonly using (true)', t.relname);
    end if;
    touched := touched + 1;
  end loop;

  revoke all on public.mcp_api_keys from mcp_readonly;
  revoke all on public.mcp_audit_log from mcp_readonly;
  return touched;
end;
$$;

revoke all on function public.mcp_readonly_refresh_grants(boolean) from public;

select public.mcp_readonly_refresh_grants(true);
