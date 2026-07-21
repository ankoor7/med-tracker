-- Stage 18 (FR-18.1) — add the effective-dated schedule-snapshot record type.
--
-- Mirrors the client change in src/core/cloudRecord.ts (RecordType +
-- validateScheduleSnapshot). Keep validate_record in lock-step with the TS
-- rules; the pgTAP suite (schedule_snapshot_test.sql) covers parity so drift is
-- caught.
--
-- A scheduleSnapshot is the whole regimen as it stood at one instant: when it
-- took effect (`effectiveFrom`), the zone it was captured in, and full copies of
-- the medications and slots. Read paths resolve "what was my regimen on day D"
-- against these instead of reapplying the current configuration, so a dose
-- change today cannot rewrite yesterday's history.
--
-- The nested medications/slots are validated with the *same* rules as their
-- standalone record types, so a snapshot can never smuggle in a shape the
-- top-level validators would reject.

-- New record type. Forward-only; safe to re-run (IF NOT EXISTS).
alter type record_type add value if not exists 'scheduleSnapshot';

-- Nested-entity validators, factored out so the snapshot branch and the
-- top-level branches cannot drift apart.
create or replace function _valid_medication(p jsonb)
  returns text language plpgsql immutable as
$$
begin
  if jsonb_typeof(p) is distinct from 'object' then return 'medication invalid'; end if;
  if not _is_str(p->'name') then return 'medication.name required'; end if;
  if not _is_str(p->'unit') then return 'medication.unit required'; end if;
  if not _is_num(p->'halfLifeHours') then return 'medication.halfLifeHours required'; end if;
  if jsonb_typeof(p->'active') is distinct from 'boolean' then return 'medication.active required'; end if;
  if not _valid_guardrails(p->'guardrails') then return 'medication.guardrails invalid'; end if;
  return null;
end
$$;

create or replace function _valid_slot(p jsonb)
  returns text language plpgsql immutable as
$$
declare
  item jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' then return 'slot invalid'; end if;
  if jsonb_typeof(p->'time') is distinct from 'string' or (p->>'time') !~ '^\d{2}:\d{2}$' then
    return 'slot.time must be HH:MM';
  end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    return 'slot.items required';
  end if;
  for item in select * from jsonb_array_elements(p->'items') loop
    if jsonb_typeof(item) is distinct from 'object'
       or not _is_str(item->'medId') or not _is_num(item->'dose') then
      return 'slot.items entry invalid';
    end if;
  end loop;
  return null;
end
$$;

-- Re-define validate_record to accept and validate the new type. The body is the
-- Stage 16 function with the medication/slot branches delegating to the helpers
-- above, plus the `scheduleSnapshot` branch and its entry in the type list.
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
         ('medication-added', 'medication-updated', 'medication-retired',
          'slot-added', 'slot-updated', 'slot-removed') then
      return 'regimenChange.kind invalid';
    end if;
    if not _is_str(p->'summary') then return 'regimenChange.summary required'; end if;
    if jsonb_typeof(p->'changes') is distinct from 'array'
       or jsonb_array_length(p->'changes') = 0 then
      return 'regimenChange.changes required';
    end if;
    for item in select * from jsonb_array_elements(p->'changes') loop
      -- Each diff entry: a string `field` and string-or-null `from`/`to`.
      if jsonb_typeof(item) is distinct from 'object'
         or not _is_str(item->'field')
         or jsonb_typeof(item->'from') not in ('string', 'null')
         or jsonb_typeof(item->'to') not in ('string', 'null') then
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
