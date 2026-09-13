-- Campus Schedule: per-user app data.
--
-- One row per user per data slice (courses, tasks, notes canvases, …),
-- mirroring the app's local storage keys. The app syncs whole slices,
-- newest write wins.
--
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.

create table if not exists public.user_data (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  key        text        not null check (key in (
               'courses', 'canvases', 'tasks', 'events',
               'settings', 'cancellations', 'grades', 'appearance'
             )),
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  -- Which device wrote last, so a device can ignore echoes of its own writes.
  device_id  text,
  primary key (user_id, key)
);

-- Only signed-in users, and only their own rows.
alter table public.user_data enable row level security;

drop policy if exists "Read own data" on public.user_data;
create policy "Read own data" on public.user_data
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Insert own data" on public.user_data;
create policy "Insert own data" on public.user_data
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Update own data" on public.user_data;
create policy "Update own data" on public.user_data
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Delete own data" on public.user_data;
create policy "Delete own data" on public.user_data
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- "Automatically expose new tables" is off, so grant access explicitly.
-- The anon (signed-out) role gets nothing.
grant select, insert, update, delete on public.user_data to authenticated;

-- Keep updated_at honest on every write.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_data_touch on public.user_data;
create trigger user_data_touch
  before update on public.user_data
  for each row execute function public.touch_updated_at();

-- Live updates to other signed-in devices (Realtime respects the policies above).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_data'
  ) then
    alter publication supabase_realtime add table public.user_data;
  end if;
end;
$$;
