-- Stage 8 — the entire server tier, in one table + one policy set + one function.
--
-- This replaces the AWS surface from Stages 3–5 (DynamoDB table, the `byUpdatedAt`
-- GSI, Lambda-enforced userId isolation, the `handlerCore` version guard and
-- schema validation). The functional contract is unchanged: a per-user store of
-- readable, typed records that the client syncs bidirectionally with last-write-wins.
--
--   - Data:      DynamoDB           -> this `records` table (payload stays jsonb).
--   - Isolation: Lambda userId scope -> Row-Level Security on auth.uid().
--   - Pull:      handlePull          -> a filtered PostgREST select (§5.1 of spec).
--   - Push:      handlePush + putIfNewer -> the push_records() RPC below (§5.2).
--   - Validation: shared TS validateSyncRecord -> validate_record() in plpgsql (§5.3, D1=A).

-- ---------------------------------------------------------------------------
-- Table (mirrors the SyncRecord envelope; see src/core/cloudRecord.ts).
-- ---------------------------------------------------------------------------
create type record_type as enum ('medication', 'slot', 'doseLog', 'settings');

create table records (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  id         text        not null,
  type       record_type not null,
  updated_at bigint      not null,          -- epoch ms (matches SyncRecord.updatedAt)
  version    integer     not null,
  deleted    boolean     not null default false,
  payload    jsonb       not null,
  primary key (user_id, id)                 -- DynamoDB PK=userId, SK=id
);

-- Incremental pull cursor (replaces the `byUpdatedAt` GSI).
create index records_by_updated_at on records (user_id, updated_at);

-- Size guard (replaces MAX_RECORD_BYTES on the server side).
alter table records
  add constraint payload_size check (pg_column_size(payload) <= 65536);

-- ---------------------------------------------------------------------------
-- Row-Level Security (replaces Lambda isolation).
--
-- The owner is never trusted from the request body: auth.uid() comes from the
-- verified GoTrue JWT, so the client can only ever read/write its own rows. This
-- holds for every path — PostgREST selects and the push RPC alike.
-- ---------------------------------------------------------------------------
alter table records enable row level security;

create policy records_select on records
  for select using (user_id = auth.uid());

create policy records_modify on records
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Server-side validation (§5.3, decision D1 = A).
--
-- A plpgsql mirror of src/core/cloudRecord.ts `validateSyncRecord`. Returns NULL
-- when the record is valid, or a human-readable reason string otherwise — the
-- same shape `handlePush` surfaced. Keep this in lock-step with the TS rules;
-- the pgTAP suite (supabase/tests/) covers parity so drift is caught.
-- ---------------------------------------------------------------------------

-- A jsonb value is a number scalar. (JSON numbers are always finite.)
-- coalesce → false so a missing key (SQL NULL) is a clean false, not NULL — else
-- `if not _is_num(...)` would evaluate to NULL and the check would be skipped.
create or replace function _is_num(j jsonb)
  returns boolean language sql immutable as
$$ select coalesce(jsonb_typeof(j) = 'number', false) $$;

-- A jsonb value is a non-empty string scalar.
create or replace function _is_str(j jsonb)
  returns boolean language sql immutable as
$$ select coalesce(jsonb_typeof(j) = 'string' and length(j #>> '{}') > 0, false) $$;

-- guardrails: each of maxSingleDose / maxDailyDose / minIntervalHours is null|number.
create or replace function _valid_guardrails(g jsonb)
  returns boolean language sql immutable as
$$
  select coalesce(
    jsonb_typeof(g) = 'object'
     and jsonb_typeof(g->'maxSingleDose')    in ('number', 'null')
     and jsonb_typeof(g->'maxDailyDose')     in ('number', 'null')
     and jsonb_typeof(g->'minIntervalHours') in ('number', 'null'),
    false)
$$;

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
  if t is null or t not in ('medication', 'slot', 'doseLog', 'settings') then
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

  elsif t = 'settings' then
    if not _is_str(p->'zone') then return 'settings.zone required'; end if;
    if not _is_num(p->'adherenceWindowDays') then return 'settings.adherenceWindowDays required'; end if;
    if not _is_num(p->'missedDayThreshold') then return 'settings.missedDayThreshold required'; end if;
  end if;

  return null; -- ok
end
$$;

-- ---------------------------------------------------------------------------
-- Push — one RPC with the LWW version guard + per-record validation (§5.2).
--
-- Returns a per-id verdict so one bad record never sinks the batch (Stage 5
-- FR-5.7). The conflict predicate is byte-for-byte the dynamoStore guard /
-- isNewerRecord: accept only if strictly newer on (updated_at, version).
-- ---------------------------------------------------------------------------
create or replace function push_records(changes jsonb)
  returns table (id text, accepted boolean, reason text)
  language plpgsql security definer set search_path = public as
$$
-- The OUT columns (id/accepted/reason) shadow the table's columns; tell plpgsql
-- that ambiguous identifiers in SQL (e.g. `on conflict (user_id, id)`) mean the
-- column, not the OUT variable. Assignments below still target the variables.
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  rec jsonb;
  v_reason text;
begin
  if uid is null then raise exception 'unauthenticated'; end if;

  for rec in select * from jsonb_array_elements(changes) loop
    v_reason := validate_record(rec);                -- null = ok
    if v_reason is not null then
      id := rec->>'id'; accepted := false; reason := v_reason; return next; continue;
    end if;

    insert into records as r (user_id, id, type, updated_at, version, deleted, payload)
    values (uid, rec->>'id', (rec->>'type')::record_type,
            (rec->>'updatedAt')::bigint, (rec->>'version')::int,
            coalesce((rec->>'deleted')::boolean, false), rec->'payload')
    on conflict (user_id, id) do update
      set updated_at = excluded.updated_at, version = excluded.version,
          deleted = excluded.deleted, payload = excluded.payload, type = excluded.type
      -- LWW guard: identical predicate to dynamoStore + isNewerRecord.
      where excluded.updated_at > r.updated_at
         or (excluded.updated_at = r.updated_at and excluded.version > r.version);

    id := rec->>'id';
    accepted := found;                               -- false = stale (LWW loss)
    reason := case when found then null else 'stale version' end;
    return next;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Privileges. The signed-in (`authenticated`) role needs table privileges for
-- the PostgREST pull and execute on the push RPC; RLS then confines every row to
-- the caller. The `anon` role gets nothing — only signed-in users sync.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on records to authenticated;
grant execute on function push_records(jsonb) to authenticated;
