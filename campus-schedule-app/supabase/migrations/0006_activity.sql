-- Isked 0006: Friend activity — share what you're doing (the task in Doing,
-- or one you just finished) with classmates in your sections and people
-- you've shared a course with.
-- Requires 0002. Safe to re-run.
-- Run in: Supabase → SQL Editor → New query → paste → Run.
--
-- Same rules as before: you only see activity from people you're connected
-- to, everyone can only change their own row, sizes are capped, writes are
-- rate-limited, and nothing is shared unless the app's "Share what I'm
-- doing" is turned on.

-- =========================================================================
-- Who opened whose share code (a connection for Friend activity)
-- =========================================================================

create table if not exists public.course_share_links (
  owner_id   uuid        not null references auth.users (id) on delete cascade,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, user_id),
  check (owner_id <> user_id)
);

create index if not exists course_share_links_user_idx on public.course_share_links (user_id);

alter table public.course_share_links enable row level security;

-- Either person can see and remove the connection. Only get_shared_course adds one.
drop policy if exists "People see their share links" on public.course_share_links;
create policy "People see their share links" on public.course_share_links
  for select to authenticated using ((select auth.uid()) in (owner_id, user_id));

drop policy if exists "People remove their share links" on public.course_share_links;
create policy "People remove their share links" on public.course_share_links
  for delete to authenticated using ((select auth.uid()) in (owner_id, user_id));

-- Same as 0002, plus recording the connection when someone opens your code.
create or replace function public.get_shared_course(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c jsonb;
  owner uuid;
begin
  if uid is null then
    raise exception 'Sign in to add a shared course.' using errcode = '42501';
  end if;
  perform public.hit_rate_limit(uid, 'open_share_code', 60, interval '1 hour', 'Too many codes tried — wait a while and try again.');
  update public.shared_courses
     set use_count = use_count + 1
   where code = upper(btrim(coalesce(p_code, '')))
  returning course, owner_id into c, owner;
  if c is not null and owner <> uid then
    insert into public.course_share_links (owner_id, user_id) values (owner, uid)
    on conflict do nothing;
  end if;
  return c;
end;
$$;

-- You, someone in one of your sections, or someone you've shared a course with (either way).
create or replace function public.is_circle(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_other = (select auth.uid())
    or exists (
      select 1
      from public.section_members me
      join public.section_members them on them.section_id = me.section_id
      where me.user_id = (select auth.uid()) and them.user_id = p_other
    )
    or exists (
      select 1 from public.course_share_links l
      where (l.owner_id = (select auth.uid()) and l.user_id = p_other)
         or (l.user_id = (select auth.uid()) and l.owner_id = p_other)
    );
$$;

-- =========================================================================
-- Friend activity: one row per person
-- =========================================================================

create table if not exists public.user_activity (
  user_id      uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text        not null check (char_length(btrim(display_name)) between 1 and 40),
  status       text        not null check (status in ('doing', 'finished')),
  title        text        not null check (char_length(btrim(title)) between 1 and 140),
  course_code  text        check (course_code is null or char_length(course_code) <= 32),
  since        timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.user_activity enable row level security;

create or replace function public.user_activity_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
  elsif new.user_id <> old.user_id then
    raise exception 'Activity can''t be moved to another person.' using errcode = 'P0001';
  end if;
  new.display_name := btrim(new.display_name);
  new.title := btrim(new.title);
  new.course_code := nullif(btrim(coalesce(new.course_code, '')), '');
  -- The time comes from the device, but never from the future or long ago.
  if new.since is null or new.since > now() or new.since < now() - interval '7 days' then
    new.since := now();
  end if;
  new.updated_at := now();
  perform public.hit_rate_limit(auth.uid(), 'activity', 240, interval '1 hour', 'Activity updated too often — try again in a bit.');
  return new;
end;
$$;

drop trigger if exists user_activity_guard on public.user_activity;
create trigger user_activity_guard
  before insert or update on public.user_activity
  for each row execute function public.user_activity_guard();

drop policy if exists "Your circle sees your activity" on public.user_activity;
create policy "Your circle sees your activity" on public.user_activity
  for select to authenticated using (public.is_circle(user_id));

drop policy if exists "People share their own activity" on public.user_activity;
create policy "People share their own activity" on public.user_activity
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "People update their own activity" on public.user_activity;
create policy "People update their own activity" on public.user_activity
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "People stop sharing their activity" on public.user_activity;
create policy "People stop sharing their activity" on public.user_activity
  for delete to authenticated using ((select auth.uid()) = user_id);

-- =========================================================================
-- Privileges
-- =========================================================================

revoke all on public.user_activity, public.course_share_links from anon, authenticated;

grant select, insert, update, delete on public.user_activity to authenticated;
grant select, delete on public.course_share_links to authenticated;

revoke execute on function public.user_activity_guard() from public, anon, authenticated;

revoke execute on function public.is_circle(uuid) from public, anon;
grant execute on function public.is_circle(uuid) to authenticated;

-- Live updates (row rules apply per listener).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_activity'
  ) then
    alter publication supabase_realtime add table public.user_activity;
  end if;
end;
$$;
