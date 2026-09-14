-- Campus Schedule 0004: reminders when the app is closed (web push) and
-- calendar links (e.g. UVLE) that the server keeps in sync.
-- Requires 0002. Safe to re-run.
-- Run in: Supabase → SQL Editor → New query → paste → Run.
-- Then follow "Background reminders & calendar links" in supabase/README.md
-- to deploy the two Edge Functions and schedule them.

-- =========================================================================
-- Push subscriptions (one per browser/device)
-- =========================================================================

create table if not exists public.push_subscriptions (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  -- Only real push services: the server posts to this URL, so it must never
  -- be an arbitrary or internal address.
  endpoint      text        not null unique check (
                  char_length(endpoint) <= 1000
                  and endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/'
                ),
  p256dh        text        not null check (char_length(p256dh) between 20 and 200),
  auth          text        not null check (char_length(auth) between 8 and 100),
  -- Minutes ahead of UTC on that device (Manila = 480), so reminders use local time.
  tz_offset_min integer     not null default 480 check (tz_offset_min between -720 and 840),
  created_at    timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Read own push subscriptions" on public.push_subscriptions;
create policy "Read own push subscriptions" on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Remove own push subscriptions" on public.push_subscriptions;
create policy "Remove own push subscriptions" on public.push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Saving goes through this function: a browser's endpoint moves to whoever
-- is signed in on it now, and each person keeps at most 10 devices.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_tz_offset_min integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  perform public.hit_rate_limit(uid, 'push_subscribe', 30, interval '1 day', 'Notifications were turned on too often today.');
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, tz_offset_min)
  values (uid, p_endpoint, p_p256dh, p_auth, greatest(-720, least(840, coalesce(p_tz_offset_min, 480))));
  delete from public.push_subscriptions
   where id in (select id from public.push_subscriptions where user_id = uid order by created_at desc offset 10);
end;
$$;

-- Which reminders already went out (server only; users can't read or change it).
create table if not exists public.sent_reminders (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  reminder_id text        not null check (char_length(reminder_id) <= 200),
  sent_at     timestamptz not null default now(),
  primary key (user_id, reminder_id)
);

alter table public.sent_reminders enable row level security;

-- =========================================================================
-- Calendar links kept in sync (e.g. UVLE → Export calendar → link)
-- =========================================================================

create table if not exists public.calendar_feeds (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  url             text        not null check (char_length(url) <= 2000 and url ~ '^https://[A-Za-z0-9.-]+(:443)?(/\S*)?$'),
  label           text        check (label is null or char_length(label) <= 80),
  created_at      timestamptz not null default now(),
  -- Written by the server only (a user's writes reset these).
  last_checked_at timestamptz,
  last_status     text        check (last_status is null or last_status in ('ok', 'error')),
  last_error      text        check (last_error is null or char_length(last_error) <= 300),
  imported_count  integer     not null default 0,
  unique (user_id, url)
);

alter table public.calendar_feeds enable row level security;

create or replace function public.calendar_feeds_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  total integer;
begin
  -- auth.uid() is null only for the server's own (service role) updates.
  if auth.uid() is not null then
    new.user_id := auth.uid();
    new.last_checked_at := null;
    new.last_status := null;
    new.last_error := null;
    new.imported_count := 0;
    select count(*) into total from public.calendar_feeds where user_id = new.user_id;
    if total >= 3 then
      raise exception 'You can keep up to 3 calendar links in sync.' using errcode = 'P0001';
    end if;
    perform public.hit_rate_limit(new.user_id, 'calendar_feed', 20, interval '1 day', 'Calendar links added too often today.');
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_feeds_guard on public.calendar_feeds;
create trigger calendar_feeds_guard
  before insert on public.calendar_feeds
  for each row execute function public.calendar_feeds_guard();

drop policy if exists "Read own calendar links" on public.calendar_feeds;
create policy "Read own calendar links" on public.calendar_feeds
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Add own calendar links" on public.calendar_feeds;
create policy "Add own calendar links" on public.calendar_feeds
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Remove own calendar links" on public.calendar_feeds;
create policy "Remove own calendar links" on public.calendar_feeds
  for delete to authenticated using ((select auth.uid()) = user_id);

-- =========================================================================
-- Privileges
-- =========================================================================

revoke all on public.push_subscriptions, public.sent_reminders, public.calendar_feeds from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant select, insert, delete on public.calendar_feeds to authenticated;
-- sent_reminders: no user access at all.

-- The Edge Functions run as service_role; newer projects don't grant it
-- table access automatically.
grant select, insert, update, delete on public.push_subscriptions, public.sent_reminders, public.calendar_feeds, public.items to service_role;

revoke execute on function public.calendar_feeds_guard() from public, anon, authenticated;
revoke execute on function public.save_push_subscription(text, text, text, integer) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, integer) to authenticated;
