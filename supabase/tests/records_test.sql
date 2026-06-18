-- pgTAP suite for the server logic that now lives in SQL (Stage 8 §8).
-- Run with:  supabase test db
--
-- Covers what handlerCore.test.ts + the cross-user isolation tests used to:
--   - RLS: user A cannot see or modify user B's rows.
--   - push_records: LWW guard (newer wins / stale rejected), idempotent re-push,
--     one invalid record doesn't block valid siblings.
--   - validate_record parity with src/core/cloudRecord.ts validateSyncRecord.

begin;
select plan(21);

-- Two real auth users (records.user_id FKs auth.users).
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000a',
   'authenticated', 'authenticated', 'a@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000b',
   'authenticated', 'authenticated', 'b@test.local', now(), now());

-- Helper: become a given user for RLS / auth.uid().
create or replace function _be(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- A valid medication record builder.
create or replace function _med(rid text, uat bigint, ver int) returns jsonb language sql as $$
  select jsonb_build_object(
    'id', rid, 'type', 'medication', 'updatedAt', uat, 'version', ver,
    'payload', jsonb_build_object(
      'name', 'Lamotrigine', 'unit', 'mg', 'halfLifeHours', 12, 'active', true,
      'guardrails', jsonb_build_object(
        'maxSingleDose', null, 'maxDailyDose', null, 'minIntervalHours', null)))
$$;

-- ---------------------------------------------------------------------------
-- validate_record parity
-- ---------------------------------------------------------------------------
select is(validate_record(_med('m1', 1000, 1)), null, 'valid medication passes');
select is(validate_record('{"type":"medication","updatedAt":1,"version":1,"payload":{}}'::jsonb),
  'missing id', 'missing id rejected');
select is(validate_record('{"id":"x","type":"nope","updatedAt":1,"version":1,"payload":{}}'::jsonb),
  'unknown type: nope', 'unknown type rejected');
select is(validate_record('{"id":"x","type":"medication","version":1,"payload":{}}'::jsonb),
  'missing updatedAt', 'missing updatedAt rejected');
select is(validate_record('{"id":"x","type":"medication","updatedAt":1,"version":1,"payload":{"id":"x"}}'::jsonb),
  'medication.name required', 'incomplete medication payload rejected');
select is(
  validate_record('{"id":"x","type":"slot","updatedAt":1,"version":1,"payload":{"time":"9:00","items":[]}}'::jsonb),
  'slot.time must be HH:MM', 'bad slot time rejected');
select is(
  validate_record(jsonb_build_object('id','t','type','medication','updatedAt',1,'version',1,
    'deleted',true,'payload',jsonb_build_object())),
  null, 'tombstone skips deep validation');

-- doseOverride parity (Stage 12).
select is(
  validate_record('{"id":"o1","type":"doseOverride","updatedAt":1,"version":1,"payload":
    {"slotId":"s1","medId":"m1","scheduledInstant":1000,"zone":"Europe/London","dose":50}}'::jsonb),
  null, 'valid doseOverride passes');
select is(
  validate_record('{"id":"o1","type":"doseOverride","updatedAt":1,"version":1,"payload":
    {"slotId":"s1","scheduledInstant":1000,"zone":"Europe/London","dose":50}}'::jsonb),
  'doseOverride.medId required', 'doseOverride missing medId rejected');

-- ---------------------------------------------------------------------------
-- push_records — LWW guard, idempotency, mixed batch
-- ---------------------------------------------------------------------------
set local role authenticated;
select _be('00000000-0000-0000-0000-00000000000a');

select is((select accepted from push_records(jsonb_build_array(_med('m1', 1000, 1)))),
  true, 'first write accepted');
select is((select count(*)::int from records where id = 'm1'), 1, 'one row stored');

-- Stale write (older updatedAt) is rejected, row unchanged.
select is((select reason from push_records(jsonb_build_array(_med('m1', 500, 1)))),
  'stale version', 'older updatedAt rejected as stale');
select is((select updated_at from records where id = 'm1'), 1000::bigint, 'row kept newer value');

-- Newer write wins.
select is((select accepted from push_records(jsonb_build_array(_med('m1', 2000, 2)))),
  true, 'newer updatedAt accepted');
select is((select updated_at from records where id = 'm1'), 2000::bigint, 'row advanced');

-- Idempotent re-push of the same (updatedAt, version) is a no-op (stale).
select is((select accepted from push_records(jsonb_build_array(_med('m1', 2000, 2)))),
  false, 're-push of identical record is a no-op');

-- Mixed batch: one invalid record does not block its valid sibling.
select results_eq(
  $q$ select accepted from push_records(jsonb_build_array(
        _med('good', 3000, 1),
        '{"id":"bad","type":"medication","updatedAt":3000,"version":1,"payload":{"id":"bad"}}'::jsonb))
      order by id $q$,
  $v$ values (false), (true) $v$,
  'invalid sibling rejected, valid one accepted');

-- ---------------------------------------------------------------------------
-- RLS — cross-user isolation
-- ---------------------------------------------------------------------------
select is((select count(*)::int from records), 2, 'user A sees only its own rows');

select _be('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from records), 0, 'user B sees none of A''s rows');

-- B writes its own row; still cannot see A's.
select is((select accepted from push_records(jsonb_build_array(_med('m1', 1000, 1)))),
  true, 'user B can write its own row with the same id');
select is((select count(*)::int from records), 1, 'user B sees only its own row');

select * from finish();
rollback;
