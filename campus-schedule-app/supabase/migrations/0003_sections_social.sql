-- Campus Schedule 0003: section deadline check-offs and comments, shared
-- free times, read-only shared notes, and a public deadlines page.
-- Requires 0002. Safe to re-run.
-- Run in: Supabase → SQL Editor → New query → paste → Run.
--
-- Same rules as 0002: only members see a section's data, everyone can only
-- change their own rows, sizes are capped, writes are rate-limited, and the
-- public page shows only deadline titles and dates behind its own code.

-- =========================================================================
-- "I submitted it" check-offs
-- =========================================================================

create table if not exists public.section_post_marks (
  post_id    uuid        not null references public.section_posts (id) on delete cascade,
  section_id uuid        not null references public.sections (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists section_post_marks_section_idx on public.section_post_marks (section_id);

alter table public.section_post_marks enable row level security;

create or replace function public.section_post_marks_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.user_id := auth.uid();
  new.created_at := now();
  -- The section always comes from the post, never from the client.
  select section_id into new.section_id from public.section_posts where id = new.post_id;
  if new.section_id is null then
    raise exception 'That deadline no longer exists.' using errcode = 'P0001';
  end if;
  perform public.hit_rate_limit(new.user_id, 'post_mark', 300, interval '1 hour', 'Too many check-offs — try again in a bit.');
  return new;
end;
$$;

drop trigger if exists section_post_marks_guard on public.section_post_marks;
create trigger section_post_marks_guard
  before insert on public.section_post_marks
  for each row execute function public.section_post_marks_guard();

drop policy if exists "Members see check-offs" on public.section_post_marks;
create policy "Members see check-offs" on public.section_post_marks
  for select to authenticated using (public.is_section_member(section_id));

drop policy if exists "Members check off for themselves" on public.section_post_marks;
create policy "Members check off for themselves" on public.section_post_marks
  for insert to authenticated
  with check ((select auth.uid()) = user_id and public.is_section_member(section_id));

drop policy if exists "Members undo their own check-offs" on public.section_post_marks;
create policy "Members undo their own check-offs" on public.section_post_marks
  for delete to authenticated using ((select auth.uid()) = user_id);

-- =========================================================================
-- Comments on deadlines
-- =========================================================================

create table if not exists public.section_post_comments (
  id         uuid        primary key default gen_random_uuid(),
  post_id    uuid        not null references public.section_posts (id) on delete cascade,
  section_id uuid        not null references public.sections (id) on delete cascade,
  author_id  uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  body       text        not null check (char_length(btrim(body)) between 1 and 300),
  created_at timestamptz not null default now()
);

create index if not exists section_post_comments_post_idx on public.section_post_comments (post_id, created_at);
create index if not exists section_post_comments_section_idx on public.section_post_comments (section_id);

alter table public.section_post_comments enable row level security;

create or replace function public.section_post_comments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  total integer;
begin
  new.author_id := auth.uid();
  new.created_at := now();
  new.body := btrim(new.body);
  select section_id into new.section_id from public.section_posts where id = new.post_id;
  if new.section_id is null then
    raise exception 'That deadline no longer exists.' using errcode = 'P0001';
  end if;
  perform public.hit_rate_limit(new.author_id, 'section_comment', 40, interval '1 hour', 'You''re commenting a lot — wait a little.');
  select count(*) into total from public.section_post_comments where post_id = new.post_id;
  if total >= 200 then
    raise exception 'This deadline has 200 comments already.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists section_post_comments_guard on public.section_post_comments;
create trigger section_post_comments_guard
  before insert on public.section_post_comments
  for each row execute function public.section_post_comments_guard();

drop policy if exists "Members read comments" on public.section_post_comments;
create policy "Members read comments" on public.section_post_comments
  for select to authenticated using (public.is_section_member(section_id));

drop policy if exists "Members comment as themselves" on public.section_post_comments;
create policy "Members comment as themselves" on public.section_post_comments
  for insert to authenticated
  with check ((select auth.uid()) = author_id and public.is_section_member(section_id));

drop policy if exists "Authors and owners delete comments" on public.section_post_comments;
create policy "Authors and owners delete comments" on public.section_post_comments
  for delete to authenticated
  using ((select auth.uid()) = author_id or public.is_section_owner(section_id));

-- =========================================================================
-- Shared free times (busy blocks only — no course names)
-- =========================================================================

create table if not exists public.section_busy_times (
  section_id uuid        not null references public.sections (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  busy       jsonb       not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (section_id, user_id)
);

alter table public.section_busy_times enable row level security;

-- Keep only {d: weekday, s: start minute, e: end minute}; drop anything else.
create or replace function public.section_busy_times_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b jsonb;
  clean jsonb := '[]'::jsonb;
begin
  if tg_op = 'UPDATE' and (new.section_id <> old.section_id or new.user_id <> old.user_id) then
    raise exception 'Free times can''t be moved to another section or person.' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
  end if;
  if jsonb_typeof(new.busy) is distinct from 'array' or jsonb_array_length(new.busy) > 80 then
    raise exception 'At most 80 busy blocks.' using errcode = '22023';
  end if;
  for b in select value from jsonb_array_elements(new.busy) loop
    if jsonb_typeof(b) = 'object'
       and (b ->> 'd') ~ '^[0-6]$'
       and (b ->> 's') ~ '^\d{1,4}$' and (b ->> 'e') ~ '^\d{1,4}$'
       and (b ->> 's')::integer < (b ->> 'e')::integer
       and (b ->> 'e')::integer <= 1440 then
      clean := clean || jsonb_build_array(jsonb_build_object('d', (b ->> 'd')::integer, 's', (b ->> 's')::integer, 'e', (b ->> 'e')::integer));
    end if;
  end loop;
  new.busy := clean;
  new.updated_at := now();
  perform public.hit_rate_limit(auth.uid(), 'busy_times', 60, interval '1 hour', 'Free times updated too often — try again later.');
  return new;
end;
$$;

drop trigger if exists section_busy_times_guard on public.section_busy_times;
create trigger section_busy_times_guard
  before insert or update on public.section_busy_times
  for each row execute function public.section_busy_times_guard();

drop policy if exists "Members see shared free times" on public.section_busy_times;
create policy "Members see shared free times" on public.section_busy_times
  for select to authenticated using (public.is_section_member(section_id));

drop policy if exists "Members share their own free times" on public.section_busy_times;
create policy "Members share their own free times" on public.section_busy_times
  for insert to authenticated
  with check ((select auth.uid()) = user_id and public.is_section_member(section_id));

drop policy if exists "Members update their own free times" on public.section_busy_times;
create policy "Members update their own free times" on public.section_busy_times
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and public.is_section_member(section_id));

drop policy if exists "Members stop sharing free times" on public.section_busy_times;
create policy "Members stop sharing free times" on public.section_busy_times
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Leaving (or being removed from) a section takes your free times with you.
create or replace function public.section_members_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.section_busy_times where section_id = old.section_id and user_id = old.user_id;
  return null;
end;
$$;

drop trigger if exists section_members_after_delete on public.section_members;
create trigger section_members_after_delete
  after delete on public.section_members
  for each row execute function public.section_members_after_delete();

-- =========================================================================
-- Read-only shared notes (text notes and to-do lists)
-- =========================================================================

create table if not exists public.section_shared_notes (
  id         uuid        primary key default gen_random_uuid(),
  section_id uuid        not null references public.sections (id) on delete cascade,
  owner_id   uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  title      text        not null check (char_length(btrim(title)) between 1 and 80),
  notes      jsonb       not null default '[]'::jsonb check (
               jsonb_typeof(notes) = 'array' and jsonb_array_length(notes) <= 200 and octet_length(notes::text) <= 262144
             ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists section_shared_notes_section_idx on public.section_shared_notes (section_id, updated_at);

alter table public.section_shared_notes enable row level security;

create or replace function public.section_shared_notes_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  total integer;
begin
  if tg_op = 'INSERT' then
    new.owner_id := auth.uid();
    new.created_at := now();
    select count(*) into total from public.section_shared_notes where section_id = new.section_id;
    if total >= 50 then
      raise exception 'This section already has 50 shared notes.' using errcode = 'P0001';
    end if;
  elsif new.section_id <> old.section_id or new.owner_id <> old.owner_id then
    raise exception 'Shared notes can''t be moved to another section or person.' using errcode = 'P0001';
  end if;
  new.title := btrim(new.title);
  new.updated_at := now();
  perform public.hit_rate_limit(auth.uid(), 'shared_notes', 30, interval '1 hour', 'Notes shared too often — try again later.');
  return new;
end;
$$;

drop trigger if exists section_shared_notes_guard on public.section_shared_notes;
create trigger section_shared_notes_guard
  before insert or update on public.section_shared_notes
  for each row execute function public.section_shared_notes_guard();

drop policy if exists "Members read shared notes" on public.section_shared_notes;
create policy "Members read shared notes" on public.section_shared_notes
  for select to authenticated using (public.is_section_member(section_id));

drop policy if exists "Members share their notes" on public.section_shared_notes;
create policy "Members share their notes" on public.section_shared_notes
  for insert to authenticated
  with check ((select auth.uid()) = owner_id and public.is_section_member(section_id));

drop policy if exists "Owners update their shared notes" on public.section_shared_notes;
create policy "Owners update their shared notes" on public.section_shared_notes
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id and public.is_section_member(section_id));

drop policy if exists "Owners and section owners delete shared notes" on public.section_shared_notes;
create policy "Owners and section owners delete shared notes" on public.section_shared_notes
  for delete to authenticated
  using ((select auth.uid()) = owner_id or public.is_section_owner(section_id));

-- =========================================================================
-- Public deadlines page (titles and dates only, behind its own code)
-- =========================================================================

alter table public.sections add column if not exists public_code text unique
  check (public_code is null or public_code ~ '^[A-Z2-9]{10}$');

create or replace function public.set_section_public(p_section uuid, p_enabled boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text;
begin
  if not public.is_section_owner(p_section) then
    raise exception 'Only the section owner can change the public page.' using errcode = '42501';
  end if;
  perform public.hit_rate_limit(auth.uid(), 'section_public', 20, interval '1 day', 'Public page changed too often today.');
  if not p_enabled then
    update public.sections set public_code = null where id = p_section;
    return null;
  end if;
  for attempt in 1..5 loop
    code := public.random_code(10);
    begin
      update public.sections set public_code = code where id = p_section;
      return code;
    exception when unique_violation then
      null;
    end;
  end loop;
  raise exception 'Couldn''t create a public link. Try again.' using errcode = 'P0001';
end;
$$;

-- Anyone with the code (signed in or not) sees the section name and its
-- upcoming deadline titles and dates. No notes, names or member info.
create or replace function public.get_public_section(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', s.name,
    'course_code', s.course_code,
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object('title', p.title, 'due', p.due, 'due_time', p.due_time) order by p.due, p.due_time)
      from (
        select title, due, due_time
        from public.section_posts
        where section_id = s.id and due >= ((now() at time zone 'Asia/Manila')::date - 1)
        order by due, due_time
        limit 100
      ) p
    ), '[]'::jsonb)
  )
  from public.sections s
  where s.public_code is not null
    and s.public_code = upper(btrim(coalesce(p_code, '')));
$$;

-- =========================================================================
-- Privileges
-- =========================================================================

revoke all on public.section_post_marks, public.section_post_comments, public.section_busy_times, public.section_shared_notes
  from anon, authenticated;

grant select, insert, delete on public.section_post_marks to authenticated;
grant select, insert, delete on public.section_post_comments to authenticated;
grant select, insert, update, delete on public.section_busy_times to authenticated;
grant select, insert, update, delete on public.section_shared_notes to authenticated;

revoke execute on function
  public.section_post_marks_guard(),
  public.section_post_comments_guard(),
  public.section_busy_times_guard(),
  public.section_members_after_delete(),
  public.section_shared_notes_guard()
  from public, anon, authenticated;

revoke execute on function public.set_section_public(uuid, boolean) from public, anon;
grant execute on function public.set_section_public(uuid, boolean) to authenticated;

revoke execute on function public.get_public_section(text) from public;
grant execute on function public.get_public_section(text) to anon, authenticated;

-- Live updates for check-offs and comments (row rules apply per listener).
do $$
declare
  t text;
begin
  foreach t in array array['section_post_marks', 'section_post_comments', 'section_shared_notes'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
