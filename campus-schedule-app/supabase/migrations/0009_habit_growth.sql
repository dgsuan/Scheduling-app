-- Optional coaching and small invitation-only accountability circles.
-- Requires 0002 and 0008. Run before deploying habit-coach.
begin;

create or replace function public.validate_habit_growth_fields()
returns trigger language plpgsql set search_path = '' as $$
declare field text;
begin
  if new.deleted then return new; end if;
  if new.collection = 'habit' then
    foreach field in array array['focusMinutes','breakMinutes','reminderEveryMinutes'] loop
      if new.data ? field and (jsonb_typeof(new.data->field) <> 'number' or (new.data->>field) !~ '^[0-9]+$') then raise exception 'Invalid timer or reminder duration.'; end if;
      if new.data ? field and (new.data->>field)::numeric not between 1 and 1440 then raise exception 'Duration must be between 1 and 1440 minutes.'; end if;
    end loop;
    if new.data ? 'pomodoroEnabled' and jsonb_typeof(new.data->'pomodoroEnabled') <> 'boolean' then raise exception 'Invalid Pomodoro preference.'; end if;
    foreach field in array array['reminderStart','reminderEnd'] loop
      if new.data ? field and (jsonb_typeof(new.data->field) <> 'string' or (new.data->>field) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'Invalid reminder hours.'; end if;
    end loop;
    if coalesce(new.data->>'reminderStart','09:00') >= coalesce(new.data->>'reminderEnd','21:00') then raise exception 'Reminder hours must start before they end.'; end if;
    if new.data ? 'reminderSnoozedUntil' and (jsonb_typeof(new.data->'reminderSnoozedUntil') <> 'number' or (new.data->>'reminderSnoozedUntil')::numeric < 0) then raise exception 'Invalid snooze time.'; end if;
    if new.data ? 'routine' and (jsonb_typeof(new.data->'routine') <> 'string' or char_length(new.data->>'routine') > 100) then raise exception 'Invalid routine.'; end if;
    if new.data ? 'cue' and (jsonb_typeof(new.data->'cue') <> 'string' or char_length(new.data->>'cue') > 500) then raise exception 'Invalid habit cue.'; end if;
  elsif new.collection = 'habit_log' then
    if new.data ? 'reflection' and (jsonb_typeof(new.data->'reflection') <> 'string' or char_length(new.data->>'reflection') > 2000) then raise exception 'Invalid reflection.'; end if;
    if new.data ? 'mood' and coalesce(new.data->>'mood','') not in ('low','okay','good') then raise exception 'Invalid mood.'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists habit_growth_validation on public.items;
create trigger habit_growth_validation before insert or update on public.items for each row execute function public.validate_habit_growth_fields();

create or replace function public.consume_habit_coach()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  perform public.hit_rate_limit(auth.uid(), 'habit_coach_minute', 2, interval '1 minute', 'Please wait a minute before asking again.');
  perform public.hit_rate_limit(auth.uid(), 'habit_coach_day', 20, interval '1 day', 'Your coaching limit resets tomorrow.');
end;
$$;
revoke all on function public.consume_habit_coach() from public, anon;
grant execute on function public.consume_habit_coach() to authenticated;

create table if not exists public.habit_circles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  invite_code uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create table if not exists public.habit_circle_members (
  circle_id uuid not null references public.habit_circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);
create table if not exists public.habit_circle_days (
  circle_id uuid not null,
  user_id uuid not null,
  day date not null,
  primary key (circle_id, user_id, day),
  foreign key (circle_id, user_id) references public.habit_circle_members(circle_id, user_id) on delete cascade
);
alter table public.habit_circles enable row level security;
alter table public.habit_circle_members enable row level security;
alter table public.habit_circle_days enable row level security;
-- RPC-only access prevents reading invite codes or another circle's records.
revoke all on public.habit_circles, public.habit_circle_members, public.habit_circle_days from anon, authenticated;

create or replace function public.habit_circle_action(
  p_action text, p_id uuid default null, p_code text default null,
  p_name text default null, p_title text default null, p_zone text default 'UTC'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  c public.habit_circles;
  result jsonb;
  local_day date;
begin
  if u is null then raise exception 'Sign in first.'; end if;
  if p_action not in ('list','create','join','detail','check','undo','leave','rotate') then raise exception 'Unknown action.'; end if;
  perform public.hit_rate_limit(u, 'habit_circle', 120, interval '1 hour', 'Please try again later.');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text || ':habit_circle', 0));
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_zone) then raise exception 'Invalid timezone.'; end if;
  local_day := (now() at time zone p_zone)::date;
  if p_action in ('create','join') then
    if p_name is null or char_length(trim(p_name)) not between 1 and 40 then raise exception 'Choose a display name (1–40 characters).'; end if;
    if (select count(*) from public.habit_circle_members where user_id = u) >= 10 then raise exception 'You can belong to up to 10 circles.'; end if;
    if p_action = 'create' then
      if p_title is null or char_length(trim(p_title)) not between 1 and 100 then raise exception 'Choose a circle name (1–100 characters).'; end if;
      insert into public.habit_circles(owner_id,title) values (u,trim(p_title)) returning * into c;
    else
      select * into c from public.habit_circles where invite_code::text = lower(trim(p_code)) for update;
      if c.id is null then raise exception 'That invite is unavailable.'; end if;
      if (select count(*) from public.habit_circle_members where circle_id = c.id) >= 20 then raise exception 'This circle is full.'; end if;
    end if;
    insert into public.habit_circle_members(circle_id,user_id,display_name) values(c.id,u,trim(p_name))
      on conflict (circle_id,user_id) do nothing;
    p_id := c.id;
  elsif p_action <> 'list' then
    select * into c from public.habit_circles where id = p_id for update;
    if c.id is null or not exists(select 1 from public.habit_circle_members where circle_id = p_id and user_id = u) then raise exception 'This circle is unavailable.'; end if;
    if p_action = 'leave' then
      if c.owner_id = u then delete from public.habit_circles where id = p_id;
      else delete from public.habit_circle_members where circle_id = p_id and user_id = u; end if;
      return jsonb_build_object('left',true);
    elsif p_action = 'rotate' then
      if c.owner_id <> u then raise exception 'Only the creator can replace the invite.'; end if;
      update public.habit_circles set invite_code = gen_random_uuid() where id = p_id returning * into c;
    elsif p_action = 'check' then
      insert into public.habit_circle_days(circle_id,user_id,day) values(p_id,u,local_day) on conflict do nothing;
    elsif p_action = 'undo' then
      delete from public.habit_circle_days where circle_id = p_id and user_id = u and day = local_day;
    end if;
  end if;
  if p_action = 'list' then
    select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'title',h.title,'owner',h.owner_id = u) order by h.created_at), '[]'::jsonb) into result
      from public.habit_circles h join public.habit_circle_members m on m.circle_id = h.id where m.user_id = u;
    return result;
  end if;
  return jsonb_build_object('id',c.id,'title',c.title,'owner',c.owner_id = u,
    'invite',case when c.owner_id = u then c.invite_code::text else null end,
    'day',local_day,
    'members',(select coalesce(jsonb_agg(jsonb_build_object('name',m.display_name,'me',m.user_id = u,
      'today',exists(select 1 from public.habit_circle_days d where d.circle_id = c.id and d.user_id = m.user_id and d.day = local_day),
      'days',(select count(*) from public.habit_circle_days d where d.circle_id = c.id and d.user_id = m.user_id)) order by m.joined_at),'[]'::jsonb)
      from public.habit_circle_members m where m.circle_id = c.id));
end;
$$;
revoke all on function public.habit_circle_action(text,uuid,text,text,text,text) from public, anon;
grant execute on function public.habit_circle_action(text,uuid,text,text,text,text) to authenticated;
commit;
