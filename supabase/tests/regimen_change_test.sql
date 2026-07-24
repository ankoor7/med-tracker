-- pgTAP suite for the Stage 16 regimen-change marker record type.
-- Run with:  supabase test db
--
-- Covers, for `regimenChange` (mirrors records_test.sql / events_test.sql):
--   - validate_record parity with src/core/cloudRecord.ts validateRegimenChange.
--   - push_records: LWW guard (newer wins / stale rejected) for a change record.
--   - RLS: user A cannot see user B's regimen-change rows.

begin;
select plan(22);

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
-- Stage 18 FR-18.1 — structured diffs (migration 0009)
-- ---------------------------------------------------------------------------

-- A fully structured slot-dose change: stable key, medId/slotId identity, and
-- typed numeric from/to values alongside the display strings.
select is(
  validate_record('{"id":"rc1","type":"regimenChange","updatedAt":1,"version":1,"payload":
    {"changedAt":1,"zone":"Europe/London","kind":"slot-updated","slotId":"s1",
     "summary":"Morning: Lamotrigine dose 100mg → 150mg",
     "changes":[{"field":"Lamotrigine dose","from":"100mg","to":"150mg","key":"slot.dose",
                 "medId":"m1","slotId":"s1","fromValue":100,"toValue":150}]}}'::jsonb),
  null, 'structured field change (key/medId/slotId/typed values) passes');

-- Backward compatibility: a pre-Stage-18 record has display strings only.
-- `_rchange` builds exactly that shape, and it must still validate (covered
-- above too, but asserted here as the explicit back-compat guarantee).
select is(validate_record(_rchange('rc-old', 1000, 1)), null,
  'legacy regimenChange without the machine layer still passes');

-- Boolean and null typed values (a status flip, a cleared guardrail).
select is(
  validate_record('{"id":"rc1","type":"regimenChange","updatedAt":1,"version":1,"payload":
    {"changedAt":1,"zone":"Europe/London","kind":"medication-retired","summary":"Retired X",
     "changes":[{"field":"Status","from":"Active","to":"Retired","key":"med.active",
                 "medId":"m1","fromValue":true,"toValue":false},
                {"field":"Max single dose","from":"200","to":null,
                 "key":"med.guardrails.maxSingleDose","medId":"m1",
                 "fromValue":200,"toValue":null}]}}'::jsonb),
  null, 'boolean and null typed values accepted');

-- The new kind is accepted; create and reactivate are now distinguishable.
select is(
  validate_record('{"id":"rc1","type":"regimenChange","updatedAt":1,"version":1,"payload":
    {"changedAt":1,"zone":"Europe/London","kind":"medication-reactivated","summary":"Resumed X",
     "changes":[{"field":"Status","from":"Retired","to":"Active","key":"med.active",
                 "medId":"m1","fromValue":false,"toValue":true}]}}'::jsonb),
  null, 'medication-reactivated kind accepted');

-- A key this schema does not name must still sync (forward compatibility).
select is(
  validate_record('{"id":"rc1","type":"regimenChange","updatedAt":1,"version":1,"payload":
    {"changedAt":1,"zone":"Europe/London","kind":"slot-updated","summary":"x",
     "changes":[{"field":"Future","from":null,"to":"1","key":"med.somethingNewer",
                 "fromValue":null,"toValue":1}]}}'::jsonb),
  null, 'unknown-but-well-formed key accepted (forward compatible)');

-- Malformed machine layer is rejected.
select is(
  validate_record('{"id":"rc1","type":"regimenChange","updatedAt":1,"version":1,"payload":
    {"changedAt":1,"zone":"Europe/London","kind":"slot-updated","summary":"x",
     "changes":[{"field":"Dose","from":"1","to":"2","key":42}]}}'::jsonb),
  'regimenChange.changes entry invalid', 'non-string key rejected');

select is(
  validate_record('{"id":"rc1","type":"regimenChange","updatedAt":1,"version":1,"payload":
    {"changedAt":1,"zone":"Europe/London","kind":"slot-updated","summary":"x",
     "changes":[{"field":"Dose","from":"1","to":"2","key":"slot.dose","medId":7}]}}'::jsonb),
  'regimenChange.changes entry invalid', 'non-string medId rejected');

select is(
  validate_record('{"id":"rc1","type":"regimenChange","updatedAt":1,"version":1,"payload":
    {"changedAt":1,"zone":"Europe/London","kind":"slot-updated","summary":"x",
     "changes":[{"field":"Dose","from":"1","to":"2","key":"slot.dose",
                 "fromValue":{"a":1},"toValue":2}]}}'::jsonb),
  'regimenChange.changes entry invalid', 'object typed value rejected');

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
