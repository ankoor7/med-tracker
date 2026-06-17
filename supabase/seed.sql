-- Local-only dev account, seeded into GoTrue so `supabase db reset` leaves you a
-- ready-to-use login — the Supabase-era replacement for what `pnpm local:bootstrap`
-- created on cognito-local. NOT a secret; never used in production.
--
--   dev@steadydose.local / DevPassw0rd!
--
-- GoTrue stores a bcrypt hash in auth.users.encrypted_password; pgcrypto's
-- crypt()/gen_salt('bf') produces a hash GoTrue verifies (schema-qualified as
-- `extensions.` since that's where Supabase installs pgcrypto). A matching
-- auth.identities row is required for password sign-in. The block is idempotent
-- so re-running the seed (db reset) is safe.

do $$
declare
  dev_id uuid := '00000000-0000-0000-0000-0000000d0001';
  dev_email text := 'dev@steadydose.local';
begin
  if exists (select 1 from auth.users where email = dev_email) then
    return;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    dev_id, 'authenticated', 'authenticated', dev_email,
    extensions.crypt('DevPassw0rd!', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}',
    now(), now()
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), dev_id, dev_id::text,
    json_build_object('sub', dev_id::text, 'email', dev_email),
    'email', now(), now(), now()
  );
end $$;
