-- Campus Schedule 0002: per-item sync, file storage, course sharing,
-- class sections, account deletion, and server-side abuse limits.
--
-- Every rule here is enforced by the database itself, so it holds even if
-- someone skips the app and calls Supabase directly with their own login
-- (browser dev tools, curl, a script). Safe to re-run.
-- Run in: Supabase → SQL Editor → New query → paste → Run.
-- (The "destructive operations" warning is from `drop policy if exists`.)

-- =========================================================================
-- Helpers
-- =========================================================================

-- Unbiased random codes from an unambiguous 32-character alphabet
-- (no I, O, 0, 1). 10 characters ≈ 50 bits: not guessable.
create or replace function public.random_code(len integer)
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b.bytes, g.i) % 32) + 1, 1), '' order by g.i)
  from (select extensions.gen_random_bytes(len) as bytes) b,
       generate_series(0, len - 1) as g(i);
$$;

-- Called every few days by a GitHub Action so the free project isn't
-- paused for inactivity. Returns only the time.
create or replace function public.ping()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now();
$$;

-- Per-user rate limiting (fixed windows). Rows are only written by the
-- functions below; users can't read or reset them.
create table if not exists public.rate_limits (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  action       text        not null,
  window_start timestamptz not null default now(),
  hits         integer     not null default 0,
  primary key (user_id, action)
);

alter table public.rate_limits enable row level security;

create or replace function public.hit_rate_limit(
  p_user uuid, p_action text, p_max integer, p_window interval, p_message text, p_cost integer default 1
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  total integer;
begin
  if p_user is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  insert into public.rate_limits as r (user_id, action, window_start, hits)
  values (p_user, p_action, now(), p_cost)
  on conflict (user_id, action) do update set
    hits = case when r.window_start <= now() - p_window then p_cost else r.hits + p_cost end,
    window_start = case when r.window_start <= now() - p_window then now() else r.window_start end
  returning hits into total;
  if total > p_max then
    raise exception '%', p_message using errcode = 'P0001';
  end if;
end;
$$;

-- =========================================================================
-- Per-item sync
-- =========================================================================

create table if not exists public.items (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  collection text        not null check (collection in (
               'course', 'task', 'event', 'cancellation', 'grade', 'note_item', 'drawing', 'setting'
             )),
  id         text        not null check (char_length(id) between 1 and 120),
  -- Notes and drawings: which canvas they're on.
  parent     text        check (parent is null or char_length(parent) <= 120),
  -- 1 MB per item, measured as text so compressible junk can't sneak past.
  data       jsonb       not null default '{}'::jsonb check (octet_length(data::text) <= 1048576),
  -- Deletions stay as tombstones so other devices learn about them.
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  device_id  text        check (device_id is null or char_length(device_id) <= 80),
  primary key (user_id, collection, id)
);

create index if not exists items_user_updated_idx on public.items (user_id, updated_at);

alter table public.items enable row level security;

drop policy if exists "Read own items" on public.items;
create policy "Read own items" on public.items
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Insert own items" on public.items;
create policy "Insert own items" on public.items
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Update own items" on public.items;
create policy "Update own items" on public.items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Delete own items" on public.items;
create policy "Delete own items" on public.items
  for delete to authenticated using ((select auth.uid()) = user_id);

-- How much each user stores (maintained by trigger; not user-writable).
create table if not exists public.user_usage (
  user_id    uuid    primary key references auth.users (id) on delete cascade,
  item_bytes bigint  not null default 0,
  item_count integer not null default 0
);

alter table public.user_usage enable row level security;

-- Server-set timestamps (clients can't fake "newer"), identity that can't
-- be rewritten, and tombstones that can't smuggle data.
create or replace function public.items_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.collection <> old.collection or new.id <> old.id) then
    raise exception 'An item''s owner and id can''t change.' using errcode = 'P0001';
  end if;
  if new.deleted then
    new.data := '{}'::jsonb;
    new.parent := null;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists items_before_write on public.items;
create trigger items_before_write
  before insert or update on public.items
  for each row execute function public.items_before_write();

-- Quotas and write rate. AFTER triggers, so an upsert is counted once.
create or replace function public.items_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_bytes bigint;
  delta_bytes bigint;
  delta_count integer;
  usage public.user_usage%rowtype;
begin
  if tg_op = 'DELETE' then
    update public.user_usage
       set item_bytes = greatest(0, item_bytes - octet_length(old.data::text)),
           item_count = greatest(0, item_count - 1)
     where user_id = old.user_id;
    return null;
  end if;

  new_bytes := octet_length(new.data::text);
  -- Cost: 1 per write plus 1 per 10 KB, so big rewrites use the budget faster.
  perform public.hit_rate_limit(
    new.user_id, 'item_write', 3000, interval '1 minute',
    'Too many changes in a short time — sync will try again in a minute.',
    1 + (new_bytes / 10000)::integer
  );

  if tg_op = 'INSERT' then
    delta_bytes := new_bytes;
    delta_count := 1;
  else
    delta_bytes := new_bytes - octet_length(old.data::text);
    delta_count := 0;
  end if;

  insert into public.user_usage as u (user_id, item_bytes, item_count)
  values (new.user_id, greatest(0, delta_bytes), delta_count)
  on conflict (user_id) do update set
    item_bytes = greatest(0, u.item_bytes + delta_bytes),
    item_count = u.item_count + delta_count
  returning * into usage;

  if delta_bytes > 0 and usage.item_bytes > 26214400 then
    raise exception 'Your synced data is over the 25 MB limit. Remove some large notes or drawings.' using errcode = 'P0001';
  end if;
  if delta_count > 0 and usage.item_count > 20000 then
    raise exception 'You''ve reached the limit of 20,000 synced items.' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

drop trigger if exists items_after_write on public.items;
create trigger items_after_write
  after insert or update or delete on public.items
  for each row execute function public.items_after_write();

-- The old whole-slice table is read once to migrate, then left read-only.
revoke insert, update on public.user_data from anon, authenticated;

-- =========================================================================
-- File storage (note images and attachments)
-- =========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-files', 'user-files', false, 5242880,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 50 MB and 1,000 files per person (each file is also capped at 5 MB).
create or replace function public.storage_quota_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0) < 52428800 and count(*) < 1000
  from storage.objects o
  where o.bucket_id = 'user-files'
    and (storage.foldername(o.name))[1] = (select auth.uid())::text;
$$;

-- Files live under "<user id>/…"; nobody can touch another user's folder.
drop policy if exists "user-files read own" on storage.objects;
create policy "user-files read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "user-files insert own" on storage.objects;
create policy "user-files insert own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'user-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'
    and public.storage_quota_ok()
  );

drop policy if exists "user-files update own" on storage.objects;
create policy "user-files update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "user-files delete own" on storage.objects;
create policy "user-files delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- =========================================================================
-- Share a course
-- =========================================================================

create table if not exists public.shared_courses (
  code       text        primary key check (code ~ '^[A-Z2-9]{10}$'),
  owner_id   uuid        not null references auth.users (id) on delete cascade,
  course     jsonb       not null check (octet_length(course::text) <= 16384),
  created_at timestamptz not null default now(),
  use_count  integer     not null default 0
);

create index if not exists shared_courses_owner_idx on public.shared_courses (owner_id);

alter table public.shared_courses enable row level security;

-- You can list only your own share codes. Nobody can browse others';
-- opening a code goes through get_shared_course, one exact code at a time.
drop policy if exists "Owners see their shares" on public.shared_courses;
create policy "Owners see their shares" on public.shared_courses
  for select to authenticated using ((select auth.uid()) = owner_id);

-- Keep only known course fields, with sane lengths and formats.
create or replace function public.sanitize_course(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  m jsonb;
  d jsonb;
  meetings jsonb := '[]'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid course.' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'code') is distinct from 'string' or char_length(btrim(p ->> 'code')) not between 1 and 32 then
    raise exception 'The course code must be 1–32 characters.' using errcode = '22023';
  end if;
  if coalesce(char_length(p ->> 'title'), 0) > 120
     or coalesce(char_length(p ->> 'section'), 0) > 20
     or coalesce(char_length(p ->> 'instructor'), 0) > 80 then
    raise exception 'Some course details are too long.' using errcode = '22023';
  end if;
  if p ? 'color' and coalesce(p ->> 'color', '') !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Invalid course color.' using errcode = '22023';
  end if;
  if p ? 'units' and (jsonb_typeof(p -> 'units') <> 'number' or (p ->> 'units')::numeric not between 0 and 30) then
    raise exception 'Units must be a number from 0 to 30.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p -> 'meetings', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p -> 'meetings', '[]'::jsonb)) > 10 then
    raise exception 'A course can have at most 10 meeting times.' using errcode = '22023';
  end if;

  for m in select value from jsonb_array_elements(coalesce(p -> 'meetings', '[]'::jsonb)) loop
    if jsonb_typeof(m) <> 'object' or jsonb_typeof(m -> 'days') is distinct from 'array'
       or jsonb_array_length(m -> 'days') not between 1 and 7 then
      raise exception 'Each meeting needs 1–7 days.' using errcode = '22023';
    end if;
    for d in select value from jsonb_array_elements(m -> 'days') loop
      if jsonb_typeof(d) <> 'number' or (d #>> '{}') !~ '^[0-6]$' then
        raise exception 'Meeting days must be 0–6.' using errcode = '22023';
      end if;
    end loop;
    if coalesce(m ->> 'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(m ->> 'end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Meeting times must look like 14:30.' using errcode = '22023';
    end if;
    if coalesce(char_length(m ->> 'room'), 0) > 60 then
      raise exception 'Room names can be at most 60 characters.' using errcode = '22023';
    end if;
    meetings := meetings || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'days', m -> 'days',
      'start', m ->> 'start',
      'end', m ->> 'end',
      'room', nullif(btrim(coalesce(m ->> 'room', '')), '')
    )));
  end loop;

  return jsonb_strip_nulls(jsonb_build_object(
    'code', btrim(p ->> 'code'),
    'title', nullif(btrim(coalesce(p ->> 'title', '')), ''),
    'section', nullif(btrim(coalesce(p ->> 'section', '')), ''),
    'instructor', nullif(btrim(coalesce(p ->> 'instructor', '')), ''),
    'color', p ->> 'color',
    'units', p -> 'units',
    'meetings', meetings
  ));
end;
$$;

create or replace function public.share_course(p_course jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  clean jsonb;
  active integer;
  new_code text;
begin
  if uid is null then
    raise exception 'Sign in to share a course.' using errcode = '42501';
  end if;
  perform public.hit_rate_limit(uid, 'share_course', 30, interval '1 day', 'You''ve shared a lot today — try again tomorrow.');
  select count(*) into active from public.shared_courses where owner_id = uid;
  if active >= 100 then
    raise exception 'You have 100 share codes. Stop sharing some old ones first.' using errcode = 'P0001';
  end if;
  clean := public.sanitize_course(p_course);
  for attempt in 1..5 loop
    new_code := public.random_code(10);
    begin
      insert into public.shared_courses (code, owner_id, course) values (new_code, uid, clean);
      return new_code;
    exception when unique_violation then
      null; -- astronomically unlikely; pick another code
    end;
  end loop;
  raise exception 'Couldn''t create a share code. Try again.' using errcode = 'P0001';
end;
$$;

-- Returns null for a wrong code (no exception, so failed guesses still
-- count against the rate limit instead of being rolled back).
create or replace function public.get_shared_course(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c jsonb;
begin
  if uid is null then
    raise exception 'Sign in to add a shared course.' using errcode = '42501';
  end if;
  perform public.hit_rate_limit(uid, 'open_share_code', 60, interval '1 hour', 'Too many codes tried — wait a while and try again.');
  update public.shared_courses
     set use_count = use_count + 1
   where code = upper(btrim(coalesce(p_code, '')))
  returning course into c;
  return c;
end;
$$;

create or replace function public.revoke_shared_course(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.shared_courses
   where code = upper(btrim(coalesce(p_code, ''))) and owner_id = auth.uid();
  return found;
end;
$$;

-- =========================================================================
-- Class sections: shared deadlines
-- =========================================================================

create table if not exists public.sections (
  id          uuid        primary key default gen_random_uuid(),
  owner_id    uuid        not null references auth.users (id) on delete cascade,
  name        text        not null check (char_length(btrim(name)) between 1 and 80),
  course_code text        check (course_code is null or char_length(course_code) <= 32),
  invite_code text        not null unique check (invite_code ~ '^[A-Z2-9]{10}$'),
  created_at  timestamptz not null default now()
);

create index if not exists sections_owner_idx on public.sections (owner_id);

create table if not exists public.section_members (
  section_id   uuid        not null references public.sections (id) on delete cascade,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  -- A name the member picks; emails are never shown to other members.
  display_name text        not null check (char_length(btrim(display_name)) between 1 and 40),
  role         text        not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (section_id, user_id)
);

create index if not exists section_members_user_idx on public.section_members (user_id);

create table if not exists public.section_bans (
  section_id uuid        not null references public.sections (id) on delete cascade,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  banned_at  timestamptz not null default now(),
  primary key (section_id, user_id)
);

create table if not exists public.section_posts (
  id         uuid        primary key default gen_random_uuid(),
  section_id uuid        not null references public.sections (id) on delete cascade,
  author_id  uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  title      text        not null check (char_length(btrim(title)) between 1 and 140),
  due        date        not null check (due between date '2000-01-01' and date '2100-12-31'),
  due_time   text        check (due_time is null or due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  note       text        check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists section_posts_section_idx on public.section_posts (section_id, due);
create index if not exists section_posts_author_idx on public.section_posts (author_id);

alter table public.sections enable row level security;
alter table public.section_members enable row level security;
alter table public.section_bans enable row level security;
alter table public.section_posts enable row level security;

-- Membership checks for policies (security definer so policies don't
-- recursively check themselves).
create or replace function public.is_section_member(p_section uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.section_members
    where section_id = p_section and user_id = (select auth.uid())
  );
$$;

create or replace function public.is_section_owner(p_section uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sections
    where id = p_section and owner_id = (select auth.uid())
  );
$$;

drop policy if exists "Members see their sections" on public.sections;
create policy "Members see their sections" on public.sections
  for select to authenticated using (public.is_section_member(id));

drop policy if exists "Owners delete their sections" on public.sections;
create policy "Owners delete their sections" on public.sections
  for delete to authenticated using ((select auth.uid()) = owner_id);

drop policy if exists "Members see fellow members" on public.section_members;
create policy "Members see fellow members" on public.section_members
  for select to authenticated using (public.is_section_member(section_id));

-- Members can leave; owners delete the section instead.
drop policy if exists "Members can leave" on public.section_members;
create policy "Members can leave" on public.section_members
  for delete to authenticated using ((select auth.uid()) = user_id and role <> 'owner');

drop policy if exists "Members read posts" on public.section_posts;
create policy "Members read posts" on public.section_posts
  for select to authenticated using (public.is_section_member(section_id));

drop policy if exists "Members add posts" on public.section_posts;
create policy "Members add posts" on public.section_posts
  for insert to authenticated
  with check ((select auth.uid()) = author_id and public.is_section_member(section_id));

drop policy if exists "Authors edit their posts" on public.section_posts;
create policy "Authors edit their posts" on public.section_posts
  for update to authenticated
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id and public.is_section_member(section_id));

drop policy if exists "Authors and owners delete posts" on public.section_posts;
create policy "Authors and owners delete posts" on public.section_posts
  for delete to authenticated
  using ((select auth.uid()) = author_id or public.is_section_owner(section_id));

-- (section_bans has no policies on purpose: only the functions below use it.)

-- Anti-spam and immutability for posts.
create or replace function public.section_posts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  total integer;
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.created_at := now();
    perform public.hit_rate_limit(new.author_id, 'section_post', 30, interval '1 hour',
      'You''re posting a lot — wait a little before posting again.');
    select count(*) into total from public.section_posts where section_id = new.section_id;
    if total >= 500 then
      raise exception 'This section has 500 posts. Ask the owner to clear old ones.' using errcode = 'P0001';
    end if;
  else
    if new.section_id <> old.section_id or new.author_id <> old.author_id or new.created_at <> old.created_at then
      raise exception 'A post can''t be moved to another section or author.' using errcode = 'P0001';
    end if;
    perform public.hit_rate_limit(auth.uid(), 'section_post_edit', 60, interval '1 hour',
      'Too many edits — wait a little and try again.');
  end if;
  new.title := btrim(new.title);
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists section_posts_guard on public.section_posts;
create trigger section_posts_guard
  before insert or update on public.section_posts
  for each row execute function public.section_posts_guard();

create or replace function public.create_section(p_name text, p_course_code text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  owned integer;
  sid uuid;
  code text;
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'The section name must be 1–80 characters.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 40 then
    raise exception 'Your display name must be 1–40 characters.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_course_code, '')) > 32 then
    raise exception 'The course code is too long.' using errcode = '22023';
  end if;
  perform public.hit_rate_limit(uid, 'create_section', 10, interval '1 day', 'You''ve created a lot of sections today — try again tomorrow.');
  select count(*) into owned from public.sections where owner_id = uid;
  if owned >= 20 then
    raise exception 'You can own at most 20 sections.' using errcode = 'P0001';
  end if;
  for attempt in 1..5 loop
    code := public.random_code(10);
    begin
      insert into public.sections (owner_id, name, course_code, invite_code)
      values (uid, btrim(p_name), nullif(btrim(coalesce(p_course_code, '')), ''), code)
      returning id into sid;
      exit;
    exception when unique_violation then
      sid := null;
    end;
  end loop;
  if sid is null then
    raise exception 'Couldn''t create the section. Try again.' using errcode = 'P0001';
  end if;
  insert into public.section_members (section_id, user_id, display_name, role)
  values (sid, uid, btrim(p_display_name), 'owner');
  return jsonb_build_object('id', sid, 'invite_code', code);
end;
$$;

-- Returns the section id, or null when the code is wrong or you're banned
-- (the same answer either way, and failed guesses count toward the limit).
create or replace function public.join_section(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  mine integer;
  members integer;
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 40 then
    raise exception 'Your display name must be 1–40 characters.' using errcode = '22023';
  end if;
  perform public.hit_rate_limit(uid, 'join_section', 20, interval '1 hour', 'Too many join attempts — wait a while and try again.');
  select id into sid from public.sections where invite_code = upper(btrim(coalesce(p_code, '')));
  if sid is null or exists (select 1 from public.section_bans where section_id = sid and user_id = uid) then
    return null;
  end if;
  if exists (select 1 from public.section_members where section_id = sid and user_id = uid) then
    return sid;
  end if;
  select count(*) into mine from public.section_members where user_id = uid;
  if mine >= 50 then
    raise exception 'You can be in at most 50 sections.' using errcode = 'P0001';
  end if;
  select count(*) into members from public.section_members where section_id = sid;
  if members >= 300 then
    raise exception 'This section is full (300 members).' using errcode = 'P0001';
  end if;
  insert into public.section_members (section_id, user_id, display_name)
  values (sid, uid, btrim(p_display_name));
  return sid;
end;
$$;

create or replace function public.rotate_section_invite(p_section uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text;
begin
  if not public.is_section_owner(p_section) then
    raise exception 'Only the section owner can change the invite code.' using errcode = '42501';
  end if;
  perform public.hit_rate_limit(auth.uid(), 'rotate_invite', 20, interval '1 day', 'Invite code changed too often today.');
  for attempt in 1..5 loop
    code := public.random_code(10);
    begin
      update public.sections set invite_code = code where id = p_section;
      return code;
    exception when unique_violation then
      null;
    end;
  end loop;
  raise exception 'Couldn''t change the invite code. Try again.' using errcode = 'P0001';
end;
$$;

create or replace function public.remove_section_member(p_section uuid, p_user uuid, p_ban boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_section_owner(p_section) then
    raise exception 'Only the section owner can remove members.' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'Owners can''t remove themselves — delete the section instead.' using errcode = 'P0001';
  end if;
  delete from public.section_members where section_id = p_section and user_id = p_user;
  if p_ban then
    insert into public.section_bans (section_id, user_id) values (p_section, p_user)
    on conflict do nothing;
  end if;
end;
$$;

create or replace function public.set_section_display_name(p_section uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 40 then
    raise exception 'Your display name must be 1–40 characters.' using errcode = '22023';
  end if;
  perform public.hit_rate_limit(auth.uid(), 'display_name', 20, interval '1 hour', 'Name changed too often — try again later.');
  update public.section_members set display_name = btrim(p_name)
   where section_id = p_section and user_id = auth.uid();
  if not found then
    raise exception 'You''re not in that section.' using errcode = '42501';
  end if;
end;
$$;

-- =========================================================================
-- Delete my account
-- =========================================================================

-- Deletes the signed-in user; cascades remove their items, shares, owned
-- sections, memberships and posts. The app deletes their files first.
-- Requires a sign-in within the last 10 minutes (the app asks for the
-- password again), so a stolen, long-lived session alone can't do it.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  amr jsonb := auth.jwt() -> 'amr';
begin
  if uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if jsonb_typeof(amr) is distinct from 'array' or not exists (
    select 1 from jsonb_array_elements(amr) a
    where (a ->> 'timestamp') ~ '^\d+$'
      and (a ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - 600
  ) then
    raise exception 'For safety, enter your password again right before deleting your account.' using errcode = '42501';
  end if;
  delete from auth.users where id = uid;
end;
$$;

-- =========================================================================
-- Privileges: explicit and minimal
-- =========================================================================

revoke all on public.items, public.user_usage, public.rate_limits, public.shared_courses,
              public.sections, public.section_members, public.section_bans, public.section_posts
  from anon, authenticated;

grant select, insert, update, delete on public.items to authenticated;
grant select on public.shared_courses to authenticated;
grant select, delete on public.sections to authenticated;
grant select, delete on public.section_members to authenticated;
grant select, insert, update, delete on public.section_posts to authenticated;
-- user_usage, rate_limits, section_bans: no direct access at all.

-- Internal helpers and trigger functions: not callable through the API.
revoke execute on function
  public.random_code(integer),
  public.hit_rate_limit(uuid, text, integer, interval, text, integer),
  public.sanitize_course(jsonb),
  public.items_before_write(),
  public.items_after_write(),
  public.section_posts_guard()
  from public, anon, authenticated;

-- App-facing functions: signed-in users only.
revoke execute on function
  public.share_course(jsonb),
  public.get_shared_course(text),
  public.revoke_shared_course(text),
  public.create_section(text, text, text),
  public.join_section(text, text),
  public.rotate_section_invite(uuid),
  public.remove_section_member(uuid, uuid, boolean),
  public.set_section_display_name(uuid, text),
  public.delete_my_account(),
  public.is_section_member(uuid),
  public.is_section_owner(uuid),
  public.storage_quota_ok()
  from public, anon;

grant execute on function
  public.share_course(jsonb),
  public.get_shared_course(text),
  public.revoke_shared_course(text),
  public.create_section(text, text, text),
  public.join_section(text, text),
  public.rotate_section_invite(uuid),
  public.remove_section_member(uuid, uuid, boolean),
  public.set_section_display_name(uuid, text),
  public.delete_my_account(),
  public.is_section_member(uuid),
  public.is_section_owner(uuid),
  public.storage_quota_ok()
  to authenticated;

revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;

-- =========================================================================
-- Live updates (Realtime applies the row rules above per listener)
-- =========================================================================

do $$
declare
  t text;
begin
  foreach t in array array['items', 'section_posts'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
