-- Stage 6 follow-up — schedule the `send-push` Edge Function.
--
-- Migration 0005 left the pg_cron block commented because it needs the project
-- ref + a Vault secret. Both are now resolvable: the project ref is public (it is
-- part of the function URL), and the service-role token is read from Vault *at
-- run time* (not migration time), so nothing secret is committed here.
--
-- Prerequisites handled OUT of git (see supabase/README.md):
--   1. `send-push` Edge Function deployed (the integration deploys it on push).
--   2. Edge Function secrets set: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
--   3. A Vault secret named `service_role_key` holding the project's service-role
--      key (Dashboard → Project Settings → API). Until it exists the cron fires
--      but the function rejects the call (401) — harmless; it self-heals once set.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent (re)scheduling: drop any prior job of the same name, then create it.
select cron.unschedule('send-push-every-minute')
where exists (select 1 from cron.job where jobname = 'send-push-every-minute');

select cron.schedule(
  'send-push-every-minute',
  '* * * * *',
  $$
    select net.http_post(
      url     := 'https://wrkwygwzycgukwhsiokz.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret
                                         from vault.decrypted_secrets
                                         where name = 'service_role_key')
      )
    );
  $$
);
