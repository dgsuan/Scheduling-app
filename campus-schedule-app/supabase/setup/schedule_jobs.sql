-- Schedules the two Edge Functions (run AFTER deploying them).
-- Step 1: replace both placeholder values below, then run this whole file once
--   in Supabase → SQL Editor. Re-running replaces the jobs and secrets.
--   • YOUR-PROJECT-REF: from your project URL (https://YOUR-PROJECT-REF.supabase.co)
--   • CRON-SECRET: a long random string you make up; set the SAME value as the
--     CRON_SECRET function secret (see supabase/README.md). Don't commit it.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Secrets live in Vault, not in the job definitions.
delete from vault.secrets where name in ('campus_functions_url', 'campus_cron_secret');
select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co/functions/v1', 'campus_functions_url');
select vault.create_secret('CRON-SECRET', 'campus_cron_secret');

select cron.unschedule(jobid) from cron.job where jobname in ('campus-reminders', 'campus-calendar-feeds');

-- Every minute: send due class and task reminders.
select cron.schedule('campus-reminders', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'campus_functions_url') || '/reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'campus_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
$$);

-- Every 30 minutes: refresh saved calendar links.
select cron.schedule('campus-calendar-feeds', '*/30 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'campus_functions_url') || '/calendar-feeds',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'campus_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
$$);
