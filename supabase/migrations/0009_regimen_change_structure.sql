-- Stage 18 (FR-18.1) — structured regimen-change diffs.
--
-- Mirrors the client change in src/core/cloudRecord.ts (isValidFieldChange +
-- REGIMEN_CHANGE_KIND_NAMES). Keep validate_record in lock-step with the TS
-- rules; the pgTAP suite (regimen_change_test.sql) covers parity so drift is
-- caught.
--
-- Two changes to the `regimenChange` contract:
--
--  1. A new kind, `medication-reactivated`. Resuming a retired prescription and
--     first prescribing one were both recorded as `medication-added`, so the two
--     events were indistinguishable when read back.
--
--  2. Each entry in `changes` may now carry a machine layer alongside the
--     display strings: a stable `key`, the `medId`/`slotId` the field belongs
--     to, and typed `fromValue`/`toValue`. Previously a slot dose change was
--     keyed only by a medication's display *name*, which breaks on duplicate
--     names, a later rename, or a deleted medication.
--
-- Every part of the machine layer is OPTIONAL: records written before this
-- migration carry display strings only and must keep validating unchanged. No
-- backfill is attempted — structure is never inferred from a formatted string.
--
-- `key` is checked as any non-empty string rather than against a fixed
-- vocabulary, so a newer client can sync a key this schema does not yet name.

-- Shared entry validator for a `changes` element, so the regimenChange branch
-- reads as one call and the rules live in exactly one place.
create or replace function _valid_field_change(item jsonb)
  returns boolean language sql immutable as
$$
  select
    jsonb_typeof(item) = 'object'
    -- Display layer (required).
    and _is_str(item->'field')
    and jsonb_typeof(item->'from') in ('string', 'null')
    and jsonb_typeof(item->'to') in ('string', 'null')
    -- Machine layer (optional; well-formed when present).
    and (not item ? 'key' or _is_str(item->'key'))
    and (not item ? 'medId' or _is_str(item->'medId'))
    and (not item ? 'slotId' or _is_str(item->'slotId'))
    and (not item ? 'fromValue'
         or jsonb_typeof(item->'fromValue') in ('string', 'number', 'boolean', 'null'))
    and (not item ? 'toValue'
         or jsonb_typeof(item->'toValue') in ('string', 'number', 'boolean', 'null'));
$$;

-- Re-define validate_record. The body is the Stage 18 (0008) function with the
-- regimenChange branch's kind list extended and its per-entry check delegated to
-- _valid_field_change; every other branch is unchanged.
create or replace function validate_record(rec jsonb)
  returns text language plpgsql immutable as
$$
declare
  t    text  := rec->>'type';
  p    jsonb := rec->'payload';
  item jsonb;
  err  text;
begin
  -- Envelope ---------------------------------------------------------------
  if jsonb_typeof(rec) is distinct from 'object' then return 'record must be an object'; end if;
  if not _is_str(rec->'id') then return 'missing id'; end if;
  if t is null or t not in
       ('medication', 'slot', 'doseLog', 'doseOverride', 'eventType', 'eventInstance',
        'regimenChange', 'scheduleSnapshot', 'settings')
  then
    return 'unknown type: ' || coalesce(t, 'undefined');
  end if;
  if not _is_num(rec->'updatedAt') then return 'missing updatedAt'; end if;
  if not _is_num(rec->'version') then return 'missing version'; end if;
  if rec ? 'deleted' and jsonb_typeof(rec->'deleted') is distinct from 'boolean' then
    return 'deleted must be a boolean';
  end if;
  if jsonb_typeof(p) is distinct from 'object' then return 'payload must be an object'; end if;

  -- Size guard (whole record, since the payload dominates it).
  if octet_length(rec::text) > 65536 then return 'record too large'; end if;

  -- Tombstones may carry a minimal payload; skip deep field validation.
  if (rec->>'deleted')::boolean is true then return null; end if;

  -- Payload by type --------------------------------------------------------
  if t = 'medication' then
    return _valid_medication(p);

  elsif t = 'slot' then
    return _valid_slot(p);

  elsif t = 'doseLog' then
    if not _is_str(p->'slotId') then return 'doseLog.slotId required'; end if;
    if not _is_str(p->'medId') then return 'doseLog.medId required'; end if;
    if not _is_num(p->'scheduledInstant') then return 'doseLog.scheduledInstant required'; end if;
    if not _is_num(p->'actualInstant') then return 'doseLog.actualInstant required'; end if;
    if not _is_num(p->'dose') then return 'doseLog.dose required'; end if;
    if (p->>'status') is distinct from 'taken' and (p->>'status') is distinct from 'skipped' then
      return 'doseLog.status invalid';
    end if;

  elsif t = 'doseOverride' then
    if not _is_str(p->'slotId') then return 'doseOverride.slotId required'; end if;
    if not _is_str(p->'medId') then return 'doseOverride.medId required'; end if;
    if not _is_num(p->'scheduledInstant') then return 'doseOverride.scheduledInstant required'; end if;
    if not _is_str(p->'zone') then return 'doseOverride.zone required'; end if;
    if not _is_num(p->'dose') then return 'doseOverride.dose required'; end if;

  elsif t = 'eventType' then
    if not _is_str(p->'name') then return 'eventType.name required'; end if;
    if jsonb_typeof(p->'properties') is distinct from 'array' then
      return 'eventType.properties required';
    end if;
    for item in select * from jsonb_array_elements(p->'properties') loop
      if jsonb_typeof(item) is distinct from 'object'
         or not _is_str(item->'id') or not _is_str(item->'name')
         or (item->>'type') not in ('number', 'text', 'scale', 'duration') then
        return 'eventType.properties entry invalid';
      end if;
    end loop;

  elsif t = 'eventInstance' then
    if not _is_str(p->'typeId') then return 'eventInstance.typeId required'; end if;
    if not _is_num(p->'occurredAt') then return 'eventInstance.occurredAt required'; end if;
    if not _is_str(p->'zone') then return 'eventInstance.zone required'; end if;
    if jsonb_typeof(p->'values') is distinct from 'object' then
      return 'eventInstance.values required';
    end if;

  elsif t = 'regimenChange' then
    if not _is_num(p->'changedAt') then return 'regimenChange.changedAt required'; end if;
    if not _is_str(p->'zone') then return 'regimenChange.zone required'; end if;
    if (p->>'kind') not in
         ('medication-added', 'medication-reactivated', 'medication-updated',
          'medication-retired', 'slot-added', 'slot-updated', 'slot-removed') then
      return 'regimenChange.kind invalid';
    end if;
    if not _is_str(p->'summary') then return 'regimenChange.summary required'; end if;
    if jsonb_typeof(p->'changes') is distinct from 'array'
       or jsonb_array_length(p->'changes') = 0 then
      return 'regimenChange.changes required';
    end if;
    for item in select * from jsonb_array_elements(p->'changes') loop
      if not _valid_field_change(item) then
        return 'regimenChange.changes entry invalid';
      end if;
    end loop;
    if p ? 'note' and jsonb_typeof(p->'note') is distinct from 'string' then
      return 'regimenChange.note must be a string';
    end if;

  elsif t = 'scheduleSnapshot' then
    if not _is_num(p->'effectiveFrom') then return 'scheduleSnapshot.effectiveFrom required'; end if;
    if not _is_str(p->'zone') then return 'scheduleSnapshot.zone required'; end if;
    if jsonb_typeof(p->'medications') is distinct from 'array' then
      return 'scheduleSnapshot.medications required';
    end if;
    if jsonb_typeof(p->'slots') is distinct from 'array' then
      return 'scheduleSnapshot.slots required';
    end if;
    for item in select * from jsonb_array_elements(p->'medications') loop
      if jsonb_typeof(item) is distinct from 'object' or not _is_str(item->'id') then
        return 'scheduleSnapshot.medications entry invalid';
      end if;
      err := _valid_medication(item);
      if err is not null then
        return 'scheduleSnapshot.medications entry invalid: ' || err;
      end if;
    end loop;
    for item in select * from jsonb_array_elements(p->'slots') loop
      if jsonb_typeof(item) is distinct from 'object' or not _is_str(item->'id') then
        return 'scheduleSnapshot.slots entry invalid';
      end if;
      err := _valid_slot(item);
      if err is not null then
        return 'scheduleSnapshot.slots entry invalid: ' || err;
      end if;
    end loop;

  elsif t = 'settings' then
    if not _is_str(p->'zone') then return 'settings.zone required'; end if;
    if not _is_num(p->'adherenceWindowDays') then return 'settings.adherenceWindowDays required'; end if;
    if not _is_num(p->'missedDayThreshold') then return 'settings.missedDayThreshold required'; end if;
  end if;

  return null; -- ok
end
$$;
