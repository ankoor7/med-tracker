-- pgTAP suite for the Stage 13 health-condition event record types, extended
-- in Stage 24 (FR-24.6, P0 #5) for occurrence-linked side-effect attribution.
-- Run with:  supabase test db
--
-- Covers, for `eventType` / `eventInstance` (mirrors records_test.sql):
--   - validate_record parity with src/core/cloudRecord.ts validateSyncRecord.
--   - push_records: LWW guard (newer wins / stale rejected) for an event record.
--   - RLS: user A cannot see user B's event rows.
--   - Stage 24: eventInstance.medId/doseLogEntryId and eventType.category
--     validation, including the settled spec §7 Q1 call — a dangling medId
--     (referencing no existing record) is ACCEPTED here, because referential
--     integrity is the client resolver's job
--     (core/sideEffects.ts:validateEventAttribution), not this per-record,
--     immutable SQL validator.

begin;
select plan(20);

-- Two real auth users (records.user_id FKs auth.users).
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000ea',
   'authenticated', 'authenticated', 'ea@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000eb',
   'authenticated', 'authenticated', 'eb@test.local', now(), now());

-- Helper: become a given user for RLS / auth.uid().
create or replace function _be(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- A valid event-type record builder.
create or replace function _etype(rid text, uat bigint, ver int) returns jsonb language sql as $$
  select jsonb_build_object(
    'id', rid, 'type', 'eventType', 'updatedAt', uat, 'version', ver,
    'payload', jsonb_build_object(
      'name', 'Seizure', 'color', '#9333ea',
      'properties', jsonb_build_array(
        jsonb_build_object('id', 'severity', 'name', 'Severity', 'type', 'scale', 'min', 1, 'max', 5),
        jsonb_build_object('id', 'duration', 'name', 'Duration', 'type', 'duration'))))
$$;

-- ---------------------------------------------------------------------------
-- validate_record parity — eventType / eventInstance
-- ---------------------------------------------------------------------------
select is(validate_record(_etype('et1', 1000, 1)), null, 'valid eventType passes');

select is(
  validate_record('{"id":"et1","type":"eventType","updatedAt":1,"version":1,"payload":
    {"color":"#000","properties":[]}}'::jsonb),
  'eventType.name required', 'eventType missing name rejected');

select is(
  validate_record('{"id":"et1","type":"eventType","updatedAt":1,"version":1,"payload":
    {"name":"X","properties":[{"id":"p","name":"P","type":"bogus"}]}}'::jsonb),
  'eventType.properties entry invalid', 'eventType bad property type rejected');

select is(
  validate_record('{"id":"ei1","type":"eventInstance","updatedAt":1,"version":1,"payload":
    {"typeId":"et1","occurredAt":1000,"zone":"Europe/London","values":{"severity":4}}}'::jsonb),
  null, 'valid eventInstance passes');

select is(
  validate_record('{"id":"ei1","type":"eventInstance","updatedAt":1,"version":1,"payload":
    {"occurredAt":1000,"zone":"Europe/London","values":{}}}'::jsonb),
  'eventInstance.typeId required', 'eventInstance missing typeId rejected');

select is(
  validate_record(jsonb_build_object('id','ei1','type','eventInstance','updatedAt',1,'version',1,
    'deleted',true,'payload',jsonb_build_object())),
  null, 'tombstone eventInstance skips deep validation');

-- ---------------------------------------------------------------------------
-- Stage 24 (FR-24.6, P0 #5) — side-effect attribution
-- ---------------------------------------------------------------------------

-- An attributed eventInstance: both medId and doseLogEntryId present.
select is(
  validate_record('{"id":"ei2","type":"eventInstance","updatedAt":1,"version":1,"payload":
    {"typeId":"et1","occurredAt":1000,"zone":"Europe/London","values":{},
     "medId":"med-1","doseLogEntryId":"log-1"}}'::jsonb),
  null, 'eventInstance attributed to a medication and dose passes');

select is(
  validate_record('{"id":"ei3","type":"eventInstance","updatedAt":1,"version":1,"payload":
    {"typeId":"et1","occurredAt":1000,"zone":"Europe/London","values":{},"medId":42}}'::jsonb),
  'eventInstance.medId must be a string', 'eventInstance with a non-string medId rejected');

-- A present-but-JSON-null medId must be rejected the same way, not silently
-- accepted the way a bare `not in (...)` (with no jsonb_typeof guard) would
-- have let it through — see the jsonb_typeof guard above.
select is(
  validate_record('{"id":"ei3b","type":"eventInstance","updatedAt":1,"version":1,"payload":
    {"typeId":"et1","occurredAt":1000,"zone":"Europe/London","values":{},"medId":null}}'::jsonb),
  'eventInstance.medId must be a string', 'eventInstance with a null medId rejected');

-- Settled spec §7 Q1: a `medId` that references no existing record in the
-- database is ACCEPTED — validate_record is immutable and sees one record at
-- a time, so it cannot perform the cross-record lookup. Referential integrity
-- is the client resolver's job (core/sideEffects.ts:validateEventAttribution).
select is(
  validate_record('{"id":"ei4","type":"eventInstance","updatedAt":1,"version":1,"payload":
    {"typeId":"et1","occurredAt":1000,"zone":"Europe/London","values":{},
     "medId":"no-such-medication-anywhere"}}'::jsonb),
  null, 'eventInstance with a dangling medId is accepted (client resolver''s job)');

select is(
  validate_record('{"id":"et2","type":"eventType","updatedAt":1,"version":1,"payload":
    {"name":"Nausea","color":"#000","properties":[],"category":"side-effect"}}'::jsonb),
  null, 'eventType with category side-effect passes');

select is(
  validate_record('{"id":"et3","type":"eventType","updatedAt":1,"version":1,"payload":
    {"name":"X","color":"#000","properties":[],"category":"bogus"}}'::jsonb),
  'eventType.category invalid', 'eventType with an unknown category rejected');

-- A present-but-JSON-null category is a value, not an absence, and must be
-- rejected the same way an unknown string is (see the jsonb_typeof guard
-- above the `not in` check).
select is(
  validate_record('{"id":"et3b","type":"eventType","updatedAt":1,"version":1,"payload":
    {"name":"X","color":"#000","properties":[],"category":null}}'::jsonb),
  'eventType.category invalid', 'eventType with a null category rejected');

-- ---------------------------------------------------------------------------
-- push_records — LWW guard for an event record
-- ---------------------------------------------------------------------------
set local role authenticated;
select _be('00000000-0000-0000-0000-0000000000ea');

select is((select accepted from push_records(jsonb_build_array(_etype('et1', 1000, 1)))),
  true, 'first eventType write accepted');
select is((select count(*)::int from records where id = 'et1'), 1, 'one event row stored');

select is((select reason from push_records(jsonb_build_array(_etype('et1', 500, 1)))),
  'stale version', 'older updatedAt rejected as stale');

select is((select accepted from push_records(jsonb_build_array(_etype('et1', 2000, 2)))),
  true, 'newer updatedAt accepted');
select is((select updated_at from records where id = 'et1'), 2000::bigint, 'event row advanced');

-- ---------------------------------------------------------------------------
-- RLS — cross-user isolation for event rows
-- ---------------------------------------------------------------------------
select is((select count(*)::int from records), 1, 'user A sees only its own event row');

select _be('00000000-0000-0000-0000-0000000000eb');
select is((select count(*)::int from records), 0, 'user B sees none of A''s event rows');

select * from finish();
rollback;
