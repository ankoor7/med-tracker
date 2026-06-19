-- Stage 6 follow-up — background Web Push relay.
--
-- The client computes reminder *timing* (src/core/reminders.ts) and mirrors
-- upcoming reminders into `scheduled_pushes`, registering each device's push
-- subscription in `push_subscriptions`. The `send-push` Edge Function (run on a
-- schedule, see the bottom of this file) delivers due rows to those
-- subscriptions even when the app is fully closed. The server does NO schedule
-- math — it only stores and delivers, so there is no timezone/schedule logic to
-- keep in parity with the client (unlike validate_record in 0001).
--
-- Safety: a delivered push carries only that a dose is due — never an amount.

-- ---------------------------------------------------------------------------
-- Push subscriptions (one row per browser/device; endpoint is globally unique).
-- ---------------------------------------------------------------------------
create table push_subscriptions (
  endpoint   text        primary key,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh     text        not null,
  auth       text        not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_by_user on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

-- Owner-only, exactly like records (auth.uid() from the verified JWT).
create policy push_subscriptions_owner on push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Scheduled pushes (the relay queue the client mirrors its reminders into).
-- ---------------------------------------------------------------------------
create table scheduled_pushes (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null,                    -- ScheduledReminder.id (dedupe key)
  fire_at    bigint      not null,                    -- epoch ms (matches the client)
  title      text        not null,
  body       text        not null,
  url        text        not null default '/',        -- click target; carries ?take=… for doses
  can_take   boolean     not null default false,      -- offer a "Mark taken" action
  sent       boolean     not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
-- Partial index over the queue the sender scans each tick.
create index scheduled_pushes_due on scheduled_pushes (fire_at) where sent = false;

alter table scheduled_pushes enable row level security;

create policy scheduled_pushes_owner on scheduled_pushes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The signed-in role manages its own rows; RLS confines them to the caller. The
-- sender reads across users via the service-role key (which bypasses RLS) inside
-- the Edge Function — never the client.
grant select, insert, update, delete on push_subscriptions to authenticated;
grant select, insert, update, delete on scheduled_pushes to authenticated;

-- ---------------------------------------------------------------------------
-- Scheduling the sender.
--
-- The `send-push` Edge Function (supabase/functions/send-push) does the delivery.
-- Invoke it about once a minute. With pg_cron + pg_net (both available on
-- Supabase) and the function URL + a service-role key stored in Vault:
--
--   select cron.schedule(
--     'send-push-every-minute',
--     '* * * * *',
--     $$
--       select net.http_post(
--         url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/send-push',
--         headers := jsonb_build_object(
--           'Content-Type', 'application/json',
--           'Authorization', 'Bearer ' || (select decrypted_secret
--                                            from vault.decrypted_secrets
--                                            where name = 'service_role_key')
--         )
--       );
--     $$
--   );
--
-- This block is left commented because it needs the project ref and a Vault
-- secret; enable it once `send-push` is deployed (see supabase/README.md).
