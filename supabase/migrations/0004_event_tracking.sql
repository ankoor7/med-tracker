-- Stage 13 — add the user-defined health-condition event record types.
--
-- Mirrors the client change in src/core/cloudRecord.ts (RecordType +
-- validateEventType / validateEventInstance). Keep validate_record in lock-step
-- with the TS rules; the pgTAP suite covers parity so drift is caught.
--
-- Two new types:
--   - eventType:     a user-defined event schema (name + colour + property defs).
--   - eventInstance: an occurrence of an event type at an Instant, with values
--                    keyed by property id.
-- As with guardrails, the *cross-record* check (instance values vs the type's
-- property schema) stays in the domain core — SQL validates one record at a time,
-- so validate_record only enforces each record's structural shape.

-- New record types. Forward-only; safe to re-run (IF NOT EXISTS).
alter type record_type add value if not exists 'eventType';
alter type record_type add value if not exists 'eventInstance';

-- Re-define validate_record to accept and validate the new types. The body is the
-- Stage 12 function plus the `eventType` / `eventInstance` branches and their
-- entries in the type list.
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
       ('medication', 'slot', 'doseLog', 'doseOverride', 'eventType', 'eventInstance', 'settings')
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

  elsif t = 'settings' then
    if not _is_str(p->'zone') then return 'settings.zone required'; end if;
    if not _is_num(p->'adherenceWindowDays') then return 'settings.adherenceWindowDays required'; end if;
    if not _is_num(p->'missedDayThreshold') then return 'settings.missedDayThreshold required'; end if;
  end if;

  return null; -- ok
end
$$;
