-- pgTAP suite for the Stage 20 appointment record type.
-- Run with:  supabase test db
--
-- Covers, for `appointment` (mirrors records_test.sql / regimen_change_test.sql):
--   - validate_record parity with src/core/cloudRecord.ts validateAppointment.
--   - push_records: LWW guard (newer wins / stale rejected) for an appointment.
--   - RLS: user A cannot see user B's appointment rows.

begin;
select plan(12);

-- Two real auth users (records.user_id FKs auth.users).
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000aa',
   'authenticated', 'authenticated', 'aa@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000bb',
   'authenticated', 'authenticated', 'bb@test.local', now(), now());

-- Helper: become a given user for RLS / auth.uid().
create or replace function _be(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- A valid appointment record builder.
create or replace function _appt(rid text, uat bigint, ver int) returns jsonb language sql as $$
  select jsonb_build_object(
    'id', rid, 'type', 'appointment', 'updatedAt', uat, 'version', ver,
    'payload', jsonb_build_object(
      'kind', 'appointment', 'title', 'Neurology review',
      'scheduledAt', uat, 'zone', 'Europe/London', 'status', 'scheduled',
      'provider', 'Dr Patel'))
$$;

-- ---------------------------------------------------------------------------
-- validate_record parity — appointment
-- ---------------------------------------------------------------------------
select is(validate_record(_appt('ap1', 1000, 1)), null, 'valid appointment passes');

select is(
  validate_record('{"id":"ap1","type":"appointment","updatedAt":1,"version":1,"payload":
    {"kind":"test","scheduledAt":1,"zone":"Europe/London","status":"scheduled"}}'::jsonb),
  'appointment.title required', 'appointment missing title rejected');

select is(
  validate_record('{"id":"ap1","type":"appointment","updatedAt":1,"version":1,"payload":
    {"kind":"surgery","title":"X","scheduledAt":1,"zone":"Europe/London","status":"scheduled"}}'::jsonb),
  'appointment.kind invalid', 'appointment unknown kind rejected');

select is(
  validate_record('{"id":"ap1","type":"appointment","updatedAt":1,"version":1,"payload":
    {"kind":"appointment","title":"X","scheduledAt":1,"zone":"Europe/London","status":"pending"}}'::jsonb),
  'appointment.status invalid', 'appointment unknown status rejected');

select is(
  validate_record(jsonb_build_object('id','ap1','type','appointment','updatedAt',1,'version',1,
    'deleted',true,'payload',jsonb_build_object())),
  null, 'tombstone appointment skips deep validation');

-- ---------------------------------------------------------------------------
-- push_records — LWW guard for an appointment
-- ---------------------------------------------------------------------------
set local role authenticated;
select _be('00000000-0000-0000-0000-0000000000aa');

select is((select accepted from push_records(jsonb_build_array(_appt('ap1', 1000, 1)))),
  true, 'first appointment write accepted');
select is((select count(*)::int from records where id = 'ap1'), 1, 'one appointment row stored');

select is((select reason from push_records(jsonb_build_array(_appt('ap1', 500, 1)))),
  'stale version', 'older updatedAt rejected as stale');

select is((select accepted from push_records(jsonb_build_array(_appt('ap1', 2000, 2)))),
  true, 'newer updatedAt accepted');
select is((select updated_at from records where id = 'ap1'), 2000::bigint, 'appointment row advanced');

-- ---------------------------------------------------------------------------
-- RLS — cross-user isolation for appointment rows
-- ---------------------------------------------------------------------------
select is((select count(*)::int from records), 1, 'user A sees only its own appointment row');

select _be('00000000-0000-0000-0000-0000000000bb');
select is((select count(*)::int from records), 0, 'user B sees none of A''s appointment rows');

select * from finish();
rollback;
