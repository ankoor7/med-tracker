# Stage 15 Spec — Health-Condition Event Tracking (user-defined types, synced)

| | |
|---|---|
| **Depends on** | Stage 1 (core), Stage 2 (persistence), Stages 4/5/8 (records + sync + Supabase) |
| **Implements** | FR-13.1 … FR-13.7 |
| **Milestone** | C (daily-driver polish) |
| **Status** | Done |

## 1. Objective
Let the user track occurrences of their health condition flaring up (e.g.
seizures) alongside their medications. The user defines their **own event types**
— a name plus a schema of **custom properties** (a severity scale, a duration,
and any further properties they need) — and then **logs event instances**: an
event of a given type happened at a point in time, with values filled in for that
type's properties. Events are first-class syncable records, persisted and synced
exactly like dose records.

> Worked example: the user defines a "Seizure" type with a *Severity* scale (1–5)
> and a *Duration*. Later they log "Seizure at 14:32, severity 4/5, duration 90s".
> The history view lists that occurrence; it syncs to the cloud like any record.

## 2. Scope
**In:** two new syncable entities — **`EventType`** (name + colour + an ordered
list of **custom property definitions**) and **`EventInstance`** (a typed
occurrence at a UTC `Instant` with values keyed by property id); pure-core schema
+ value validation; full persistence and **cloud sync** (records table, validator,
RLS, `push_records`, pgTAP) consistent with every other entity; UI to
define/edit event types and their properties, log an instance, and view history;
JSON export/import round-trip.
**Out:** charts/aggregation over events; reminders tied to events; correlating
events with doses (the data model permits it later); per-property conditional
logic. The app never *originates* an event — the user records it.

## 3. Prerequisites
- The Stage 4/5/8 record envelope (`core/cloudRecord.ts`), sync mapping
  (`sync/recordMapping.ts`), `LocalRepository`, and the Supabase `records` table +
  `validate_record` / `push_records`.
- The timezone rule (`core/time.ts`): every occurrence is a UTC `Instant`, and the
  zone in effect when logged is stored on the instance for stable display.

## 4. Data model
Two new syncable entities, mirroring the existing envelope conventions (`id` /
`updatedAt` / optional `version` / `deleted`):

```ts
type EventPropertyType = 'number' | 'text' | 'scale' | 'duration';

interface EventPropertyDef {
  id: string;             // stable; instance values are keyed by it
  name: string;           // e.g. "Severity"
  type: EventPropertyType;
  required?: boolean;
  min?: number;           // scale lower bound (default 1)
  max?: number;           // scale upper bound (default 5)
  unit?: string;          // optional display hint for `number`
}

interface EventType {
  id: string;
  name: string;           // e.g. "Seizure"
  color: string;          // hex, like Medication.color
  properties: EventPropertyDef[];
  notes?: string;
  archived?: boolean;     // hidden from the active picker; never deleted
  updatedAt: Instant; version?: number; deleted?: boolean;
}

type EventPropertyValue = number | string;

interface EventInstance {
  id: string;
  typeId: string;                            // references EventType.id
  occurredAt: Instant;                       // when the event happened (UTC ms)
  zone: IanaZone;                            // zone in effect when logged
  values: Record<string, EventPropertyValue>; // keyed by EventPropertyDef.id
  note?: string;
  updatedAt: Instant; version?: number; deleted?: boolean;
}
```

- Property-value encoding: `number` → finite number; `text` → string; `scale` →
  integer within `[min, max]`; `duration` → number of **seconds** (≥ 0).
- Added to `Dataset`, `RecordType` (`'eventType'`, `'eventInstance'`),
  `RECORD_TYPES`, the sync table maps (`eventTypes` ↔ `eventType`,
  `eventInstances` ↔ `eventInstance`), `Repository.TableName`, and new Dexie
  stores (structural version bump to v4).

## 5. Functional requirements
- FR-13.1. **Define event types.** The user creates an event type with a name, a
  colour, and an ordered set of custom property definitions. A new type is
  pre-populated with a *Severity* scale (1–5) and a *Duration*, both editable or
  removable.
- FR-13.2. **Custom properties.** Each property has a name, a type (`number`,
  `text`, `scale`, `duration`), an optional `required` flag, and — for scales — a
  configurable `min`/`max` range. Properties can be added, edited, and removed
  while editing a type.
- FR-13.3. **Log an instance.** The user logs an event of a chosen type at a time
  (defaulting to now, editable via the active-zone datetime entry), filling in
  values for that type's properties. The stored `occurredAt` is a UTC instant; the
  active zone is captured on the instance.
- FR-13.4. **Validate values against the schema.** Instance values are validated
  against the type's property definitions before write: required properties must be
  present; numbers/durations must be finite (durations ≥ 0); scales must be
  integers within range; text must be a string. Validation is pure core, reused by
  the UI (disables save) — the app never invents a value.
- FR-13.5. **View history.** A reverse-chronological list of logged events shows
  the type (name + colour), the local time it occurred, and a readable summary of
  the filled property values (e.g. "Severity 4/5 · Duration 1m 30s").
- FR-13.6. **Edit / archive / delete.** Instances and types are editable.
  Instances may be deleted (a tombstone — soft delete, sync-safe). **Event types
  are never deleted**: they are *archived* instead — a reversible `archived` flag
  that hides the type from the active picker while keeping its definition live and
  synced. Past instances are always preserved (history); they resolve names via
  the stored type id, including for archived types.
- FR-13.7. **Synced + portable.** Event types and instances sync via the same
  push/pull/LWW path as other records, validate structurally and identically on
  client and server, and round-trip through JSON export/import.

## 6. Technical approach
- **Core (pure):** `core/events.ts` —
  - `EVENT_PROPERTY_TYPES`, `DEFAULT_EVENT_PROPERTIES()` (the seeded Severity +
    Duration defs), `newPropertyDef(type)`.
  - `validateEventTypeShape(type)` and `validateEventInstanceValues(type, values)`
    → `string[]` of human-readable errors (empty = valid), the same "return the
    messages, let the caller block" shape as `core/guardrails.ts`.
  - Display helpers: `formatDuration(seconds)`, `formatPropertyValue(def, value)`,
    `summarizeInstance(type, instance)`.
- **Validation envelope:** add `validateEventType` / `validateEventInstance`
  branches to `core/cloudRecord.ts` (structural: field presence + types + the
  property-type enum) and a matching pair of branches to `validate_record`
  (plpgsql) — kept in lock-step; pgTAP parity test added. `record_type` gains
  `'eventType'` and `'eventInstance'`. Deep value-vs-schema checks (FR-13.4) live
  in the domain core, not in SQL — exactly like guardrails are not enforced in SQL.
- **Sync/store/repo:** extend the table↔type maps, `TableName`, the Dexie schema
  (v4), `loadAll`/`persistDataset`/`TABLES`, and `transfer.ts`
  (validate/merge, default `[]` for older files).
- **Store actions:** `addEventType` / `updateEventType` / `setEventTypeArchived`,
  `logEvent` / `updateEventInstance` / `deleteEventInstance`; hydrate/reload/import
  wiring; the first-run seed gains one example "Seizure" type.
- **UI:** a new **Events** tab/screen — define & edit types (with a property
  editor), log an instance, and a history list. Presentation only; all validation
  and formatting come from the core.

## 7. Tasks
1. `core/types.ts`: add the event entities (+ `Dataset.eventTypes` /
   `Dataset.eventInstances`).
2. `core/events.ts` (+ `core/events.test.ts`): property defaults, shape +
   value validation, display helpers.
3. `core/cloudRecord.ts`: `RecordType` + `RECORD_TYPES` + `validateEventType` /
   `validateEventInstance`.
4. `sync/recordMapping.ts` + `store/repository.ts`: table/type maps + `TableName`.
5. `store/localRepository.ts`: Dexie v4 stores; include in
   `loadAll`/`persistDataset`/`TABLES`/first-run check.
6. `store/transfer.ts`: validate/merge events (default `[]` for old files).
7. `store/store.ts`: event state + actions + hydrate/reload/import wiring.
8. `store/seed.ts`: seed an example "Seizure" type.
9. `ui/screens/EventsScreen.tsx` (+ type editor & logger); add the **Events** tab.
10. Supabase: migration extending the enum + `validate_record`; pgTAP parity +
    push/LWW test (`supabase/tests/events_test.sql`).

## 8. Acceptance criteria
- AC1. A user can define a "Seizure" type with a Severity scale (1–5) and a
  Duration, add a further custom property, and save it.
- AC2. Logging an instance with severity 4 and duration 90s stores a UTC
  `occurredAt`, the active zone, and `values` keyed by property id; it appears in
  history with a readable summary.
- AC3. Saving is blocked when a required property is missing or a scale value is
  out of range (validation runs); the app never fills a value itself.
- AC4. Archiving a type hides it from the active picker and is reversible
  (unarchive) without deleting the type or its past instances.
- AC5. Event types and instances round-trip through JSON export → import.
- AC6. `validate_record` accepts a valid `eventType` / `eventInstance` and rejects
  malformed ones, matching `validateSyncRecord` (pgTAP); a pushed event obeys the
  LWW guard and RLS scopes it to the owner.

## 9. Test plan
- Unit: `validateEventTypeShape`; `validateEventInstanceValues` (required, range,
  duration, text); `formatDuration` / `formatPropertyValue` / `summarizeInstance`;
  `validateEventType` / `validateEventInstance` envelope; record-mapping round-trip;
  transfer merge; store add/log/delete.
- pgTAP: `validate_record` parity for both event types; push accept/stale; RLS.
- (E2E, optional) define a type, log an instance, assert the synced rows.

## 10. Risks / decisions
- **Safety:** event values are always user-entered and schema-checked; the app
  never originates an event or a value (PRD safety invariant, extended to events).
- **Schema drift:** TS and SQL validators must stay in lock-step — the pgTAP
  parity test guards it (same pattern as Stages 8/12). Cross-record value
  validation (instance vs its type) stays in the domain core, not SQL, since SQL
  validates one record at a time.
- **Enum migration:** adding `record_type` values is forward-only; the migration
  uses `alter type … add value if not exists` and re-defines `validate_record`,
  applied via the normal `db push`.

## 11. Definition of done
All ACs pass; a user can define event types with custom properties, log events
against them with validated values, view a history, and have it all persist, sync,
export, and validate identically on client and server like every other record.
