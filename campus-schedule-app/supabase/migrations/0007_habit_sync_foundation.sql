-- Habit cloud-storage foundation. Run the whole file in Supabase SQL Editor.
-- Requires 0002. Does not enable client uploads or alter existing user records.
-- Existing items RLS, server timestamps, quotas and account-deletion cascade apply.
begin;

alter table public.items drop constraint if exists items_collection_check;
alter table public.items add constraint items_collection_check check (collection in (
  'course', 'task', 'event', 'cancellation', 'grade', 'note_item', 'drawing', 'setting',
  'habit', 'habit_log'
));

-- Keep deletion markers indefinitely. An offline client must not recreate a
-- deleted habit by uploading an old definition. Account deletion still cascades.
drop policy if exists "Keep habit deletion markers" on public.items;
create policy "Keep habit deletion markers" on public.items as restrictive
  for delete to authenticated using (collection not in ('habit', 'habit_log'));

create or replace function public.validate_habit_item()
returns trigger language plpgsql set search_path = '' as $$
declare
  h jsonb;
  s jsonb;
  original jsonb;
  revision text;
  previous_date text := '';
  revision_ids text[] := '{}';
begin
  if new.collection not in ('habit', 'habit_log') then return new; end if;
  if tg_op = 'UPDATE' and old.deleted and not new.deleted then
    raise exception 'A deleted habit item cannot be restored with the same ID.' using errcode = '23514';
  end if;
  if new.deleted then return new; end if;
  if jsonb_typeof(new.data) is distinct from 'object'
     or (new.data->>'id') is distinct from new.id then
    raise exception 'Habit item ID must match its data.' using errcode = '23514';
  end if;

  if new.collection = 'habit' then
    if new.parent is not null
       or jsonb_typeof(new.data->'title') is distinct from 'string'
       or length(trim(new.data->>'title')) not between 1 and 500
       or coalesce(new.data->>'type', '') not in ('binary', 'quantity', 'duration', 'avoid')
       or jsonb_typeof(new.data->'category') is distinct from 'string'
       or jsonb_typeof(new.data->'notes') is distinct from 'string'
       or jsonb_typeof(new.data->'createdAt') is distinct from 'number'
       or jsonb_typeof(new.data->'reminder') is distinct from 'boolean'
       or jsonb_typeof(new.data->'schedules') is distinct from 'array' then
      raise exception 'Invalid habit definition.' using errcode = '23514';
    end if;
    if jsonb_array_length(new.data->'schedules') not between 1 and 1000 then
      raise exception 'A habit needs 1 to 1000 schedule versions.' using errcode = '23514';
    end if;
    for s in select value from jsonb_array_elements(new.data->'schedules') loop
      if jsonb_typeof(s) is distinct from 'object'
         or coalesce(s->>'id', '') !~ '^[A-Za-z0-9_-]{1,30}$'
         or (s->>'id') = any(revision_ids)
         or coalesce(s->>'from', '') !~ '^\d{4}-\d{2}-\d{2}$'
         or (s->>'from') < previous_date
         or not exists (select 1 from pg_catalog.pg_timezone_names where name = s->>'timezone')
         or coalesce(s->>'frequency', '') not in ('daily', 'weekdays', 'interval', 'weekly')
         or coalesce(s->>'state', '') not in ('active', 'paused', 'archived')
         or jsonb_typeof(s->'target') is distinct from 'number'
         or jsonb_typeof(s->'unit') is distinct from 'string'
         or jsonb_typeof(s->'weekdays') is distinct from 'array'
         or jsonb_typeof(s->'slots') is distinct from 'array'
         or coalesce(s->>'interval', '') !~ '^[1-9][0-9]*$'
         or coalesce(s->>'quota', '') !~ '^[1-7]$'
         or coalesce(s->>'weekStart', '') !~ '^[0-6]$' then
        raise exception 'Invalid habit schedule.' using errcode = '23514';
      end if;
      perform (s->>'from')::date;
      if s ? 'until' then
        if coalesce(s->>'until', '') !~ '^\d{4}-\d{2}-\d{2}$' or (s->>'until') < (s->>'from') then
          raise exception 'Invalid habit end date.' using errcode = '23514';
        end if;
        perform (s->>'until')::date;
      end if;
      if (s->>'target')::numeric < 0 or ((new.data->>'type') <> 'avoid' and (s->>'target')::numeric <= 0)
         or jsonb_array_length(s->'weekdays') not between 1 and 7
         or exists (select 1 from jsonb_array_elements(s->'weekdays') d where d::text !~ '^[0-6]$')
         or jsonb_array_length(s->'slots') not between 1 and 24
         or exists (select 1 from jsonb_array_elements_text(s->'slots') t where t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
         or (select count(distinct t) from jsonb_array_elements_text(s->'slots') t) <> jsonb_array_length(s->'slots') then
        raise exception 'Invalid habit target, weekdays or slots.' using errcode = '23514';
      end if;
      revision_ids := array_append(revision_ids, s->>'id');
      previous_date := s->>'from';
    end loop;
    -- A used revision is immutable, including its target and timezone.
    if tg_op = 'UPDATE' then
      if (new.data->>'type') is distinct from (old.data->>'type') then
        raise exception 'Create a new habit to change tracking type.' using errcode = '23514';
      end if;
      for s in select value from jsonb_array_elements(old.data->'schedules') loop
        if exists (select 1 from public.items l where l.user_id = new.user_id
          and l.collection = 'habit_log' and l.parent = new.id and not l.deleted
          and split_part(l.data->>'occurrenceKey', ':', 2) = s->>'id')
          and not (new.data->'schedules' @> jsonb_build_array(s)) then
          raise exception 'A schedule with check-ins must be preserved.' using errcode = '23514';
        end if;
      end loop;
    end if;
  else
    if new.parent is null or (new.data->>'habitId') is distinct from new.parent
       or jsonb_typeof(new.data->'occurrenceKey') is distinct from 'string'
       or coalesce(new.data->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or jsonb_typeof(new.data->'at') is distinct from 'number'
       or jsonb_typeof(new.data->'amount') is distinct from 'number'
       or jsonb_typeof(new.data->'confirmed') is distinct from 'boolean' then
      raise exception 'Invalid habit log.' using errcode = '23514';
    end if;
    perform (new.data->>'date')::date;
    if (new.data->>'amount')::numeric < 0 then
      raise exception 'Habit amounts cannot be negative.' using errcode = '23514';
    end if;
    -- Same-owner lookup plus a row lock prevents concurrent parent deletion.
    select data into h from public.items where user_id = new.user_id
      and collection = 'habit' and id = new.parent and not deleted for share;
    if h is null then
      raise exception 'Upload the owned habit before its logs.' using errcode = '23503';
    end if;
    revision := split_part(new.data->>'occurrenceKey', ':', 2);
    if split_part(new.data->>'occurrenceKey', ':', 1) <> new.parent
       or not exists (select 1 from jsonb_array_elements(h->'schedules') v where v->>'id' = revision) then
      raise exception 'Log must reference its habit schedule.' using errcode = '23514';
    end if;
    if new.data ? 'retracts' then
      select data into original from public.items where user_id = new.user_id
        and collection = 'habit_log' and id = new.data->>'retracts' and parent = new.parent and not deleted;
      if original is null or original ? 'retracts'
         or (original->>'occurrenceKey') is distinct from (new.data->>'occurrenceKey') then
        raise exception 'Upload the original log before its correction.' using errcode = '23503';
      end if;
    end if;
    if new.data ? 'sourceId' and (jsonb_typeof(new.data->'sourceId') is distinct from 'string'
      or length(new.data->>'sourceId') not between 1 and 120) then
      raise exception 'Invalid focus-session source ID.' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and (new.data is distinct from old.data or new.parent is distinct from old.parent) then
      raise exception 'Habit logs are immutable; append a correction instead.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists items_habit_validation on public.items;
create trigger items_habit_validation before insert or update on public.items
  for each row execute function public.validate_habit_item();

-- Focus retries cannot create another entitlement for the same session.
create unique index if not exists items_habit_source_unique on public.items
  (user_id, (data->>'sourceId'))
  where collection = 'habit_log' and not deleted and data ? 'sourceId';
create index if not exists items_habit_parent_idx on public.items (user_id, parent)
  where collection = 'habit_log' and not deleted;

create or replace function public.delete_habit_child_items()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.collection = 'habit' and new.deleted and not old.deleted then
    update public.items set deleted = true where user_id = new.user_id
      and collection = 'habit_log' and parent = new.id and not deleted;
  end if;
  return null;
end;
$$;
drop trigger if exists items_habit_children_delete on public.items;
create trigger items_habit_children_delete after update on public.items
  for each row execute function public.delete_habit_child_items();

-- Capability check: clients must detect this before offering cloud habits.
create or replace function public.habit_sync_version()
returns integer language sql stable set search_path = '' as $$ select 1; $$;
revoke all on function public.habit_sync_version() from public, anon;
grant execute on function public.habit_sync_version() to authenticated;
revoke all on function public.validate_habit_item() from public, anon, authenticated;
revoke all on function public.delete_habit_child_items() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;

select public.habit_sync_version() as habit_sync_version;
