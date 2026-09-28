-- 261: keep bank / KYC data away from AI agents
--
-- venues.lunarpay_onboard_data holds the raw LunarPay application form
-- (it can include bank routing / account numbers), and its name didn't match
-- the secret-column pattern in migration 260, so run_sql could read it. Widen
-- the pattern to anything that looks like bank, tax-id or onboarding-form data,
-- then re-grant every table so the new pattern applies to existing columns.
--
-- Safe to re-run.

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
      and a.attname !~* '(token|secret|passw|api_?key|private_?key|signing_?key|access_?key|hash|salt|otp|credential|encrypted|cvv|card_number|onboard_data|routing|account_?number|bank|tax_?id|ein|ssn|_sk$|_pk$)';

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
