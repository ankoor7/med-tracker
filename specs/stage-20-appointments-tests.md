# Stage 20 Spec — Doctor's Appointments & Tests (with outcome notes)

| | |
|---|---|
| **Depends on** | Stage 1 (core), Stage 2 (persistence), Stages 4/5/8 (records + sync + Supabase) |
| **Implements** | FR-APPT-1 … FR-APPT-7 (new feature group; adjacent to the AED PRD scope) |
| **Milestone** | C (daily-driver polish) — independent of the App Store track (18/19) |
| **Status** | Ready |

## 1. Objective
Let the user **mark upcoming and past medical appointments and tests** (e.g. a
neurology review, a blood test) alongside their medications, and **add free-text
notes recording what happened** for later reference. Appointments are first-class
syncable records, persisted, validated, and synced exactly like every other entity.

> Worked example: the user adds "Neurology review, 2026-07-03 10:30, Dr Patel" as
> *upcoming*. After the visit they open it, mark it *completed*, and write "Increased
> Lamotrigine to 200mg; bloods in 6 weeks." It stays in the **Past** list with the note.

This deliberately reuses the **Stage 15 event-tracking shape** (a new syncable entity
through the same core → cloudRecord → SQL → store → sync pipeline) but is a **dedicated
`Appointment` entity**, not an event type: appointments are *scheduled* (future → past)
and carry a *status lifecycle* and *outcome notes*, which the point-in-time
`EventInstance` has no concept of.

## 2. Scope
**In:** one new syncable entity — **`Appointment`** (a `kind` of appointment/test/other,
a title, a scheduled UTC `Instant` + the zone in effect, a status of
scheduled/completed/cancelled, optional provider/location, and free-text notes);
pure-core validation + an *upcoming vs past* timing derivation + display-label helpers;
full persistence and **cloud sync** (records table, validator, RLS, `push_records`,
pgTAP) consistent with every other entity; a UI **section inside the History screen**
listing **Upcoming** and **Past** appointments with add/edit/delete and the notes field;
JSON export/import round-trip.
**Out:** **reminders/notifications** for upcoming appointments (deliberately excluded —
matches Stage 15; an easy follow-up that would reuse `core/reminders.ts`); calendar
overlay of appointments; recurring appointments; attachments/files; linking an
appointment to specific medications or regimen changes (the data model permits it
later). The app never *originates* an appointment — the user records it.

## 3. Prerequisites
- The Stage 4/5/8 record envelope (`core/cloudRecord.ts`), sync mapping
  (`sync/recordMapping.ts`), `LocalRepository`, and the Supabase `records` table +
  `validate_record` / `push_records`.
- The timezone rule (`core/time.ts`): the appointment time is a UTC `Instant`, and the
  zone in effect when set is stored for stable display (`instantToDatetimeLocal` /
  `datetimeLocalToInstant`, as the event logger uses).

## 4. Data model
One new syncable entity, mirroring the existing envelope conventions (`id` /
`updatedAt` / optional `version` / `deleted`):

```ts
type AppointmentKind = 'appointment' | 'test' | 'other';
type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled';

interface Appointment {
  id: string;
  kind: AppointmentKind;
  title: string;            // e.g. "Neurology review", "Blood test (LFTs)"
  scheduledAt: Instant;     // when it is / was (UTC ms) — drives upcoming vs past
  zone: IanaZone;           // zone in effect when set (stable display)
  status: AppointmentStatus;
  provider?: string;        // clinician / clinic / department
  location?: string;
  notes?: string;           // free text: what happened / things to remember
  updatedAt: Instant; version?: number; deleted?: boolean;
}
```

- **Upcoming vs past is derived, not stored:** `appointmentTiming(scheduledAt, now)` →
  `'upcoming' | 'past'` (upcoming when `scheduledAt >= now`). `status` is independent and
  user-set (a future appointment can be `cancelled`; a past one `completed`).
- Added to `Dataset`, `RecordType` (`'appointment'`), `RECORD_TYPES`, the sync table
  maps (`appointments` ↔ `appointment`), `Repository.TableName`, and a new Dexie store
  (structural version bump to **v7**).

## 5. Functional requirements
- FR-APPT-1. **Add an appointment/test.** The user creates one with a kind, a title, a
  date+time (entered in the active zone, stored as a UTC instant + the zone), an optional
  provider and location, and an initial status (default `scheduled`).
- FR-APPT-2. **Upcoming and past.** The History screen shows an **Upcoming** list
  (future, soonest first) and a **Past** list (elapsed, most recent first), split by the
  derived timing. A `cancelled` item is visibly marked; a `completed` item reads as done.
- FR-APPT-3. **Outcome notes.** Each appointment has a free-text **notes** field for
  "what happened," editable at any time (typically filled after the visit). The app never
  writes a note itself.
- FR-APPT-4. **Edit / status / delete.** Title, kind, time, provider, location, status,
  and notes are all editable; an appointment can be marked completed or cancelled, and
  deleted (a tombstone — soft delete, sync-safe).
- FR-APPT-5. **Validate before write.** A title is required; `kind` and `status` must be
  in their enums; `scheduledAt` must be a finite instant. Validation is pure core, reused
  by the UI (disables save) — same shape as `core/guardrails.ts` / `core/events.ts`.
- FR-APPT-6. **Synced + portable.** Appointments sync via the same push/pull/LWW path as
  other records, validate structurally and identically on client and server, and
  round-trip through JSON export/import (defaulting to `[]` for older export files).
- FR-APPT-7. **Safety unchanged.** Appointments carry no dose value and never affect
  scheduling, adherence, or guardrails — they are records only (PRD NFR-Safety holds).

## 6. Technical approach
- **Core (pure):** `core/appointments.ts` —
  - `APPOINTMENT_KINDS`, `APPOINTMENT_STATUSES` (the enum vocabularies).
  - `appointmentTiming(scheduledAt, now)` → `'upcoming' | 'past'`.
  - `validateAppointment({ kind, title, scheduledAt, status })` → `string[]` (empty =
    valid), the "return messages, let the caller block" shape.
  - Display helpers: `appointmentKindLabel(kind)`, `appointmentStatusLabel(status)`.
- **Validation envelope:** add a `validateAppointment` branch to `core/cloudRecord.ts`
  (structural: title/kind/scheduledAt/status) and a matching branch to `validate_record`
  (plpgsql) — kept in lock-step; pgTAP parity test added. `record_type` gains
  `'appointment'`.
- **Sync/store/repo:** extend the table↔type maps, `TableName`, the Dexie schema (v7:
  `appointments: 'id, updatedAt, deleted, scheduledAt, status'`),
  `loadAll`/`persistDataset`/`TABLES`/first-run check, and `transfer.ts` (validate/merge,
  default `[]` for older files).
- **Store actions:** `addAppointment` / `updateAppointment` / `deleteAppointment`;
  hydrate/reload/import wiring; the first-run seed gains one example appointment.
- **UI:** a new **Appointments & tests** card inside `HistoryScreen` (Upcoming / Past
  sub-lists) + an `AppointmentEditor` modal (zone-aware datetime). Presentation only; all
  validation and labels come from the core.

## 7. Tasks
1. `core/types.ts`: add the `Appointment` entity (+ `Dataset.appointments`).
2. `core/appointments.ts` (+ `core/appointments.test.ts`): enums, timing, validation,
   labels.
3. `core/cloudRecord.ts` (+ test): `RecordType` + `RECORD_TYPES` + `validateAppointment`.
4. `sync/recordMapping.ts` + `store/repository.ts`: table/type maps + `TableName`.
5. `store/localRepository.ts`: Dexie v7 store; include in
   `loadAll`/`persistDataset`/`TABLES`/first-run check.
6. `store/transfer.ts`: validate/merge appointments (default `[]` for old files).
7. `store/store.ts`: appointment state + actions + hydrate/reload/import wiring.
8. `store/seed.ts`: seed one example appointment.
9. `ui/screens/HistoryScreen.tsx`: the Appointments card + editor.
10. Supabase: `0008_appointments.sql` (enum + `validate_record`); pgTAP parity +
    push/LWW + RLS (`supabase/tests/appointments_test.sql`).

## 8. Acceptance criteria
- AC1. A user can add "Neurology review" at a future date/time with a provider, and it
  appears in **Upcoming**; a past-dated test appears in **Past**.
- AC2. Adding an appointment stores a UTC `scheduledAt`, the active zone, the kind, and
  status `scheduled`; the time displays correctly in the active zone.
- AC3. Editing an appointment to add a notes field ("what happened") and mark it
  `completed` persists, and it reads as completed in the Past list.
- AC4. Saving is blocked when the title is empty (validation runs); the app never fills a
  value itself.
- AC5. Appointments round-trip through JSON export → import (older files with no
  appointments import cleanly as none).
- AC6. `validate_record` accepts a valid `appointment` and rejects malformed ones
  (missing title, bad kind/status), matching `validateSyncRecord` (pgTAP); a pushed
  appointment obeys the LWW guard and RLS scopes it to the owner.

## 9. Test plan
- Unit: `validateAppointment` (title required, kind/status enum, finite scheduledAt);
  `appointmentTiming` (upcoming/past boundary); label helpers; the `validateAppointment`
  envelope in `cloudRecord`; record-mapping round-trip; transfer merge; store
  add/update/delete.
- pgTAP: `validate_record` parity for `appointment`; push accept/stale; RLS isolation.
- (E2E, optional) add an appointment, edit notes, assert the synced row.

## 10. Risks / decisions
- **Dedicated entity vs. reusing events:** chosen a dedicated `Appointment` because
  appointments are scheduled (future/past) with a status + outcome notes — concepts the
  point-in-time `EventInstance` lacks. Same *pipeline* as Stage 15, different *shape*.
- **No reminders (scope):** deliberately excluded to keep the change strictly additive
  (no reminder-engine / push-relay edits). Reminders are a clean follow-up reusing
  `core/reminders.ts` and would be the only piece touching the notification path.
- **Schema drift:** TS and SQL validators stay in lock-step — the pgTAP parity test
  guards it (same pattern as Stages 8/12/15/16).
- **Enum migration:** adding a `record_type` value is forward-only
  (`alter type … add value if not exists`) and re-defines `validate_record`, applied via
  the normal `db push`.
- **UI placement:** lives as a section inside **History** (no new top-level tab; the nav
  is a fixed 6-tab bar). History is past-focused, so the Upcoming sub-list is shown first
  to keep forward-looking items visible.

## 11. Definition of done
All ACs pass; a user can add upcoming and past appointments/tests, record outcome notes,
edit status, delete, and have it all persist, sync, export, and validate identically on
client and server like every other record; no regression in earlier stages.
