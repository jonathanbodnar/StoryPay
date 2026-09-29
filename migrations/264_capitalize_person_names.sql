-- 264: Person names always start with a capital letter
--
-- Branding rule: everywhere in the app, on public pages and in email, a
-- person's first and last name start with a capital ("jason westbrook" →
-- "Jason Westbrook"). Names arrive lowercase from imports, syncs and forms,
-- so this enforces it where they're stored:
--   • sv_capitalize_name(): capitalizes the first letter of each word (and
--     after a hyphen), never lowercases the rest (McDonald stays McDonald),
--     leaves anything with an @ alone (an email typed into a name field).
--   • A BEFORE INSERT/UPDATE trigger on every person-name column.
--   • A one-time cleanup of existing rows, with the updated_at triggers paused
--     so "last updated" dates (and anything keyed on them) don't move.
--
-- Safe to re-run.

create or replace function public.sv_capitalize_name(v text) returns text
language plpgsql immutable as $$
declare
  result text := '';
  prev text := ' ';
  ch text;
  i int;
begin
  if v is null or v = '' or position('@' in v) > 0 then
    return v;
  end if;
  v := btrim(v);
  for i in 1..char_length(v) loop
    ch := substr(v, i, 1);
    if prev in (' ', '-', '(', '"', '&', '/') then
      result := result || upper(ch);
    else
      result := result || ch;
    end if;
    prev := ch;
  end loop;
  return result;
end $$;

-- Generic trigger: TG_ARGV lists the table's name columns.
create or replace function public.sv_capitalize_name_columns() returns trigger
language plpgsql as $$
declare
  col text;
  val text;
  patch jsonb := '{}'::jsonb;
begin
  foreach col in array TG_ARGV loop
    val := to_jsonb(NEW) ->> col;
    if val is not null and val <> '' and val is distinct from public.sv_capitalize_name(val) then
      patch := patch || jsonb_build_object(col, public.sv_capitalize_name(val));
    end if;
  end loop;
  if patch <> '{}'::jsonb then
    NEW := jsonb_populate_record(NEW, patch);
  end if;
  return NEW;
end $$;

do $$
declare
  spec record;
  cols text[];
  col text;
  upd text;
  ts_trigger text;
begin
  for spec in
    select * from (values
      ('venue_customers',      array['first_name','last_name','partner_first_name','partner_last_name','coordinator_name']),
      ('leads',                array['first_name','last_name']),
      ('proposals',            array['customer_name']),
      ('venues',               array['owner_first_name','owner_last_name']),
      ('profiles',             array['full_name']),
      ('couple_profiles',      array['first_name','last_name','partner_first_name','partner_last_name','display_name']),
      ('couple_sites',         array['partner_name']),
      ('venue_team_members',   array['first_name','last_name']),
      ('support_team_members', array['first_name','last_name']),
      ('support_threads',      array['contact_name']),
      ('wedding_guests',       array['full_name']),
      ('waitlist',             array['first_name','last_name'])
    ) as t(tbl, want)
  loop
    if to_regclass('public.' || spec.tbl) is null then continue; end if;

    -- Only columns that exist on this table.
    select array_agg(c.column_name::text order by c.column_name) into cols
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = spec.tbl and c.column_name = any(spec.want);
    if cols is null then continue; end if;

    -- Trigger for every future insert/update.
    execute format('drop trigger if exists sv_capitalize_names on public.%I', spec.tbl);
    execute format(
      'create trigger sv_capitalize_names before insert or update on public.%I for each row execute function public.sv_capitalize_name_columns(%s)',
      spec.tbl,
      (select string_agg(quote_literal(x), ', ') from unnest(cols) x)
    );

    -- One-time cleanup, without touching updated_at.
    select tg.tgname into ts_trigger
      from pg_trigger tg
     where tg.tgrelid = ('public.' || spec.tbl)::regclass and not tg.tgisinternal and tg.tgname ~ 'updated_at'
     limit 1;
    if ts_trigger is not null then
      execute format('alter table public.%I disable trigger %I', spec.tbl, ts_trigger);
    end if;
    foreach col in array cols loop
      upd := format(
        'update public.%I set %I = public.sv_capitalize_name(%I) where %I is not null and %I <> public.sv_capitalize_name(%I)',
        spec.tbl, col, col, col, col, col
      );
      execute upd;
    end loop;
    if ts_trigger is not null then
      execute format('alter table public.%I enable trigger %I', spec.tbl, ts_trigger);
    end if;
  end loop;
end $$;
