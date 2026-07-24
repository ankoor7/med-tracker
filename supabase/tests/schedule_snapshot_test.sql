-- pgTAP suite for the Stage 18 (FR-18.1) schedule-snapshot record type.
-- Run with:  supabase test db
--
-- Covers, for `scheduleSnapshot` (mirrors regimen_change_test.sql):
--   - validate_record parity with src/core/cloudRecord.ts validateScheduleSnapshot,
--     including that nested medications/slots are held to the same rules as their
--     standalone record types.
--   - push_records: LWW guard (newer wins / stale rejected) for a snapshot record.
--   - RLS: user A cannot see user B's snapshot rows.

begin;
select plan(17);

-- Two real auth users (records.user_id FKs auth.users).
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000da',
   'authenticated', 'authenticated', 'da@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000db',
   'authenticated', 'authenticated', 'db@test.local', now(), now());

-- Helper: become a given user for RLS / auth.uid().
create or replace function _be(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- A valid medication / slot as they appear nested inside a snapshot.
create or replace function _snap_med() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', 'm1', 'name', 'Lamotrigine', 'color', '#0f766e', 'unit', 'mg',
    'halfLifeHours', 29, 'adjustWhenLate', true, 'active', true,
    'guardrails', jsonb_build_object(
      'maxSingleDose', 200, 'maxDailyDose', 400, 'minIntervalHours', 6))
$$;

create or replace function _snap_slot() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', 's1', 'time', '08:00', 'label', 'Morning',
    'items', jsonb_build_array(jsonb_build_object('medId', 'm1', 'dose', 150)))
$$;

-- A valid snapshot record builder.
create or replace function _snap(rid text, uat bigint, ver int) returns jsonb language sql as $$
  select jsonb_build_object(
    'id', rid, 'type', 'scheduleSnapshot', 'updatedAt', uat, 'version', ver,
    'payload', jsonb_build_object(
      'effectiveFrom', uat, 'zone', 'Europe/London',
      'medications', jsonb_build_array(_snap_med()),
      'slots', jsonb_build_array(_snap_slot())))
$$;

-- Build a snapshot whose payload replaces one key, for the negative cases.
create or replace function _snap_with(k text, v jsonb) returns jsonb language sql as $$
  select jsonb_set(_snap('sn1', 1000, 1), array['payload', k], v)
$$;

-- ---------------------------------------------------------------------------
-- validate_record parity — scheduleSnapshot
-- ---------------------------------------------------------------------------
select is(validate_record(_snap('sn1', 1000, 1)), null, 'valid scheduleSnapshot passes');

-- An empty regimen is legitimate: a user may have deleted every medication.
select is(
  validate_record(jsonb_set(
    _snap_with('medications', '[]'::jsonb), array['payload', 'slots'], '[]'::jsonb)),
  null, 'scheduleSnapshot with an empty regimen passes');

select is(
  validate_record(_snap('sn1', 1000, 1) #- '{payload,effectiveFrom}'),
  'scheduleSnapshot.effectiveFrom required', 'missing effectiveFrom rejected');

select is(
  validate_record(_snap('sn1', 1000, 1) #- '{payload,zone}'),
  'scheduleSnapshot.zone required', 'missing zone rejected');

select is(
  validate_record(_snap('sn1', 1000, 1) #- '{payload,medications}'),
  'scheduleSnapshot.medications required', 'missing medications rejected');

select is(
  validate_record(_snap('sn1', 1000, 1) #- '{payload,slots}'),
  'scheduleSnapshot.slots required', 'missing slots rejected');

select is(
  validate_record(_snap_with('medications', '{"not":"an array"}'::jsonb)),
  'scheduleSnapshot.medications required', 'non-array medications rejected');

-- Nested entities are held to the standalone rules.
select is(
  validate_record(_snap_with('medications',
    jsonb_build_array(_snap_med() - 'name'))),
  'scheduleSnapshot.medications entry invalid: medication.name required',
  'nested medication missing name rejected');

select is(
  validate_record(_snap_with('medications',
    jsonb_build_array(_snap_med() - 'id'))),
  'scheduleSnapshot.medications entry invalid',
  'nested medication missing id rejected');

select is(
  validate_record(_snap_with('slots',
    jsonb_build_array(jsonb_set(_snap_slot(), '{time}', '"8am"'::jsonb)))),
  'scheduleSnapshot.slots entry invalid: slot.time must be HH:MM',
  'nested slot with a malformed time rejected');

select is(
  validate_record(_snap_with('slots',
    jsonb_build_array(jsonb_set(_snap_slot(), '{items}', '[]'::jsonb)))),
  'scheduleSnapshot.slots entry invalid: slot.items required',
  'nested slot with no items rejected');

select is(
  validate_record(jsonb_build_object('id','sn1','type','scheduleSnapshot','updatedAt',1,'version',1,
    'deleted',true,'payload',jsonb_build_object())),
  null, 'tombstone scheduleSnapshot skips deep validation');

-- ---------------------------------------------------------------------------
-- push_records — LWW guard for a snapshot record
-- ---------------------------------------------------------------------------
set local role authenticated;
select _be('00000000-0000-0000-0000-0000000000da');

select is((select accepted from push_records(jsonb_build_array(_snap('sn1', 1000, 1)))),
  true, 'first scheduleSnapshot write accepted');

select is((select reason from push_records(jsonb_build_array(_snap('sn1', 500, 1)))),
  'stale version', 'older updatedAt rejected as stale');

select is((select accepted from push_records(jsonb_build_array(_snap('sn1', 2000, 2)))),
  true, 'newer updatedAt accepted');

-- ---------------------------------------------------------------------------
-- RLS — cross-user isolation for snapshot rows
-- ---------------------------------------------------------------------------
select is((select count(*)::int from records), 1, 'user A sees only its own snapshot row');

select _be('00000000-0000-0000-0000-0000000000db');
select is((select count(*)::int from records), 0, 'user B sees none of A''s snapshot rows');

select * from finish();
rollback;
