-- Requires 0007. Prevents stale offline edits from overwriting a concurrent edit.
-- No existing records are modified. Run the whole file.
begin;
-- Older app builds fetch unknown collections but use generic upserts. They
-- must not accidentally tombstone habit rows they cannot represent locally.
-- Only the RPC below sets this transaction-local marker, after checking owner.
create or replace function public.habit_rpc_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.collection in ('habit','habit_log') and
     coalesce(current_setting('isked.habit_writer', true), '') <> coalesce(auth.uid()::text, 'not-signed-in') then
    raise exception 'Update the app to sync habits through the versioned habit API.' using errcode='23514';
  end if;
  return new;
end;
$$;
drop trigger if exists items_habit_rpc_only on public.items;
create trigger items_habit_rpc_only before insert or update on public.items
  for each row execute function public.habit_rpc_only();
revoke all on function public.habit_rpc_only() from public, anon, authenticated;
create or replace function public.write_habit_item(
  p_owner uuid, p_collection text, p_id text, p_parent text, p_data jsonb,
  p_deleted boolean, p_expected timestamptz
) returns public.items
language plpgsql security invoker set search_path = '' as $$
declare
  found_row public.items;
  result public.items;
  previous_marker text := coalesce(current_setting('isked.habit_writer', true), '');
begin
  if auth.uid() is null then raise exception 'Sign in to sync habits.' using errcode='42501'; end if;
  if auth.uid() is distinct from p_owner then raise exception 'Account changed; habit upload refused.' using errcode='42501'; end if;
  if p_collection not in ('habit','habit_log') then raise exception 'Unsupported habit collection.' using errcode='23514'; end if;
  -- Per-account transaction lock orders habit and log writes and deletion.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text, 788));
  select * into found_row from public.items where user_id=auth.uid() and collection=p_collection and id=p_id for update;
  if found then
    -- A replay after a lost acknowledgement is already applied.
    if found_row.deleted=p_deleted and (p_deleted or (found_row.data=p_data and found_row.parent is not distinct from p_parent)) then return found_row; end if;
    if p_expected is null or found_row.updated_at <> p_expected then
      raise exception 'Habit changed on another device. Pull changes and retry.' using errcode='40001';
    end if;
    perform set_config('isked.habit_writer', auth.uid()::text, true);
    update public.items set data=p_data,parent=p_parent,deleted=p_deleted
      where user_id=auth.uid() and collection=p_collection and id=p_id returning * into result;
  else
    if p_expected is not null then raise exception 'Habit record no longer exists.' using errcode='40001'; end if;
    perform set_config('isked.habit_writer', auth.uid()::text, true);
    insert into public.items(user_id,collection,id,parent,data,deleted)
      values(auth.uid(),p_collection,p_id,p_parent,p_data,p_deleted) returning * into result;
  end if;
  perform set_config('isked.habit_writer', previous_marker, true);
  return result;
end;
$$;
revoke all on function public.write_habit_item(uuid,text,text,text,jsonb,boolean,timestamptz) from public, anon;
grant execute on function public.write_habit_item(uuid,text,text,text,jsonb,boolean,timestamptz) to authenticated;
-- One statement snapshot avoids inconsistent parent/log pagination while
-- another device writes. Existing account quota bounds this response.
create or replace function public.read_habit_items()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'collection', collection, 'id', id, 'parent', parent, 'data', data,
    'deleted', deleted, 'updated_at', updated_at
  ) order by collection, id), '[]'::jsonb)
  from public.items where user_id = auth.uid() and collection in ('habit','habit_log');
$$;
revoke all on function public.read_habit_items() from public, anon;
grant execute on function public.read_habit_items() to authenticated;
create or replace function public.habit_sync_version()
returns integer language sql stable set search_path = '' as $$ select 2; $$;
notify pgrst, 'reload schema';
commit;
select public.habit_sync_version() as habit_sync_version;
