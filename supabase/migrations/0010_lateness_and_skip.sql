-- Stage 18 (FR-18.3, FR-18.4) — skipped-dose reason + the global on-time window.
--
-- Mirrors the client change in src/core/cloudRecord.ts (validateDoseLog +
-- validateSettings). Keep validate_record in lock-step with the TS rules; the
-- pgTAP suite (records_test.sql) covers parity so drift is caught.
--
-- Two additive, optional fields — nothing existing changes shape:
--
--  1. `doseLog.skipReason` (FR-18.3): an optional free-text reason for a
--     deliberately withheld dose. Only meaningful when `status = 'skipped'`,
--     but validated generically (a string, when present) rather than tied to
--     status, same as `regimenChange.note`.
--
--  2. `settings.onTimeWindowMinutes` (FR-18.4): the single global on-time
--     window used to tell a late dose from an on-time one for adherence
--     scoring. Optional for back-compat with settings written before this
--     field existed (the client reads it as `?? DEFAULT_ON_TIME_WINDOW_MINUTES`);
--     when present it must be a positive number.

-- Re-define validate_record. The body is the Stage 18 (0009) function with the
-- doseLog and settings branches extended; every other branch is unchanged.
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
    if p ? 'skipReason' and jsonb_typeof(p->'skipReason') is distinct from 'string' then
      return 'doseLog.skipReason must be a string';
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
    if p ? 'onTimeWindowMinutes' then
      if not _is_num(p->'onTimeWindowMinutes') or (p->>'onTimeWindowMinutes')::numeric <= 0 then
        return 'settings.onTimeWindowMinutes must be a positive number';
      end if;
    end if;
  end if;

  return null; -- ok
end
$$;
