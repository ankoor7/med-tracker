-- pgTAP suite for the Stage 16 regimen-change marker record type.
-- Run with:  supabase test db
--
-- Covers, for `regimenChange` (mirrors records_test.sql / events_test.sql):
--   - validate_record parity with src/core/cloudRecord.ts validateRegimenChange.
--   - push_records: LWW guard (newer wins / stale rejected) for a change record.
--   - RLS: user A cannot see user B's regimen-change rows.

begin;
select plan(14);

-- Two real auth users (records.user_id FKs auth.users).
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000ca',
   'authenticated', 'authenticated', 'ca@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000cb',
   'authenticated', 'authenticated', 'cb@test.local', now(), now());

-- Helper: become a given user for RLS / auth.uid().
create or replace function _be(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- A valid regimen-change record builder (slot dose 100mg → 150mg).
create or replace function _rchange(rid text, uat bigint, ver int) returns jsonb language sql as $$
  select jsonb_build_object(
    'id', rid, 'type', 'regimenChange', 'updatedAt', uat, 'version', ver,
    'payload', jsonb_build_object(
      'changedAt', uat, 'zone', 'Europe/London', 'kind', 'slot-updated', 'slotId', 's1',
      'summary', 'Morning: Lamotrigine dose 100mg → 150mg',
      'changes', jsonb_build_array(
        jsonb_build_object('field', 'Lamotrigine dose', 'from', '100mg', 'to', '150mg'))))
$$;

-- ---------------------------------------------------------------------------
-- validate_record parity — regimenChange
-- ---------------------------------------------------------------------------
select is(validate_record(_rchange('rc1', 1000, 1)), null, 'valid regimenChange passes');

-- A null `from` (newly set / added value) is accepted.
select is(
  validate_record('{"id":"rc1","type":"regimenChange","updatedAt":1,"version":1,"payload":
    {"changedAt":1,"zone":"Europe/London","kind":"slot-added","summary":"Added 20:00 Evening",
     "changes":[{"field":"Time","from":null,"to":"20:00"}]}}'::jsonb),
  null, 'regimenChange with a null from/to value passes');

select is(
  validate_record('{"id":"rc1","type":"regimenChange","updatedAt":1,"version":1,"payload":
    {"changedAt":1,"zone":"Europe/London","kind":"dose-doubled","summary":"x",
     "changes":[{"field":"Time","from":null,"to":"20:00"}]}}'::jsonb),
  'regimenChange.kind invalid', 'regimenChange unknown kind rejected');

select is(
  validate_record('{"id":"rc1","type":"regimenChange","updatedAt":1,"version":1,"payload":
    {"changedAt":1,"zone":"Europe/London","kind":"slot-updated","summary":"x","changes":[]}}'::jsonb),
  'regimenChange.changes required', 'regimenChange empty changes rejected');

select is(
  validate_record('{"id":"rc1","type":"regimenChange","updatedAt":1,"version":1,"payload":
    {"changedAt":1,"zone":"Europe/London","kind":"slot-updated","summary":"x",
     "changes":[{"field":42,"from":null,"to":"20:00"}]}}'::jsonb),
  'regimenChange.changes entry invalid', 'regimenChange non-string field rejected');

select is(
  validate_record('{"id":"rc1","type":"regimenChange","updatedAt":1,"version":1,"payload":
    {"zone":"Europe/London","kind":"slot-updated","summary":"x",
     "changes":[{"field":"Time","from":null,"to":"20:00"}]}}'::jsonb),
  'regimenChange.changedAt required', 'regimenChange missing changedAt rejected');

select is(
  validate_record(jsonb_build_object('id','rc1','type','regimenChange','updatedAt',1,'version',1,
    'deleted',true,'payload',jsonb_build_object())),
  null, 'tombstone regimenChange skips deep validation');

-- ---------------------------------------------------------------------------
-- push_records — LWW guard for a change record
-- ---------------------------------------------------------------------------
set local role authenticated;
select _be('00000000-0000-0000-0000-0000000000ca');

select is((select accepted from push_records(jsonb_build_array(_rchange('rc1', 1000, 1)))),
  true, 'first regimenChange write accepted');
select is((select count(*)::int from records where id = 'rc1'), 1, 'one change row stored');

select is((select reason from push_records(jsonb_build_array(_rchange('rc1', 500, 1)))),
  'stale version', 'older updatedAt rejected as stale');

select is((select accepted from push_records(jsonb_build_array(_rchange('rc1', 2000, 2)))),
  true, 'newer updatedAt accepted');
select is((select updated_at from records where id = 'rc1'), 2000::bigint, 'change row advanced');

-- ---------------------------------------------------------------------------
-- RLS — cross-user isolation for change rows
-- ---------------------------------------------------------------------------
select is((select count(*)::int from records), 1, 'user A sees only its own change row');

select _be('00000000-0000-0000-0000-0000000000cb');
select is((select count(*)::int from records), 0, 'user B sees none of A''s change rows');

select * from finish();
rollback;
