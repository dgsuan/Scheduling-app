-- Campus Schedule 0005: let the Edge Functions (service role) use the tables
-- they need. Newer Supabase projects don't grant table access to roles
-- automatically, so the "reminders" and "calendar-feeds" functions got
-- "permission denied". Users' access is unchanged (still Row Level Security).
-- Safe to re-run. Run in: Supabase → SQL Editor → New query → paste → Run.

grant select, insert, update, delete on public.push_subscriptions to service_role;
grant select, insert, update, delete on public.sent_reminders to service_role;
grant select, insert, update, delete on public.calendar_feeds to service_role;
grant select, insert, update, delete on public.items to service_role;
