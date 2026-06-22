-- Stage 20 — add the doctor's-appointment / test record type.
--
-- Mirrors the client change in src/core/cloudRecord.ts (RecordType +
-- validateAppointment). Keep validate_record in lock-step with the TS rules; the
-- pgTAP suite (appointments_test.sql) covers parity so drift is caught.
--
-- An appointment is a scheduled (or past) medical appointment/test with free-text
-- notes for what happened: a `kind` (appointment/test/other), a title, a UTC
-- `scheduledAt`, the zone in effect, and a status (scheduled/completed/cancelled).
-- "Upcoming vs past" is derived on the client from scheduledAt, never stored. As
-- elsewhere, SQL validates one record's structural shape only.

-- New record type. Forward-only; safe to re-run (IF NOT EXISTS).
alter type record_type add value if not exists 'appointment';

-- Re-define validate_record to accept and validate the new type. The body is the
-- Stage 16 function plus the `appointment` branch and its entry in the type list.
create or replace function validate_record(rec jsonb)
  returns text language plpgsql immutable as
$$
declare
  t    text  := rec->>'type';
  p    jsonb := rec->'payload';
  item jsonb;
begin
  -- Envelope ---------------------------------------------------------------
  if jsonb_typeof(rec) is distinct from 'object' then return 'record must be an object'; end if;
  if not _is_str(rec->'id') then return 'missing id'; end if;
  if t is null or t not in
       ('medication', 'slot', 'doseLog', 'doseOverride', 'eventType', 'eventInstance',
        'regimenChange', 'appointment', 'settings')
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
    if not _is_str(p->'name') then return 'medication.name required'; end if;
    if not _is_str(p->'unit') then return 'medication.unit required'; end if;
    if not _is_num(p->'halfLifeHours') then return 'medication.halfLifeHours required'; end if;
    if jsonb_typeof(p->'active') is distinct from 'boolean' then return 'medication.active required'; end if;
    if not _valid_guardrails(p->'guardrails') then return 'medication.guardrails invalid'; end if;

  elsif t = 'slot' then
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

  elsif t = 'appointment' then
    if not _is_str(p->'title') then return 'appointment.title required'; end if;
    if (p->>'kind') is null or (p->>'kind') not in ('appointment', 'test', 'other') then
      return 'appointment.kind invalid';
    end if;
    if not _is_num(p->'scheduledAt') then return 'appointment.scheduledAt required'; end if;
    if (p->>'status') is null or (p->>'status') not in ('scheduled', 'completed', 'cancelled') then
      return 'appointment.status invalid';
    end if;
    if not _is_str(p->'zone') then return 'appointment.zone required'; end if;

  elsif t = 'settings' then
    if not _is_str(p->'zone') then return 'settings.zone required'; end if;
    if not _is_num(p->'adherenceWindowDays') then return 'settings.adherenceWindowDays required'; end if;
    if not _is_num(p->'missedDayThreshold') then return 'settings.missedDayThreshold required'; end if;
  end if;

  return null; -- ok
end
$$;
