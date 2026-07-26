# Stage 16 Spec — Regimen Change Markers (prescription & schedule history)

| | |
|---|---|
| **Depends on** | Stage 1 (core), Stage 2 (persistence), Stages 4/5/8 (records + sync + Supabase), Stage 7 (charts) |
| **Implements** | FR-16.1 … FR-16.7 |
| **Milestone** | C (daily-driver polish) |
| **Status** | Done (delivered alongside Stage 23, per user request) |

## 1. Objective
Record **when** a user's medication regimen changed and **what** changed, then
surface those changes as **markers on the timeline charts** so trends can be read
in context. When the user updates a prescription (renames a medication, changes a
standard dose or guardrail), introduces or retires a medication, or alters the
schedule (adds/removes a time-slot, re-times a slot, changes a slot's per-med
amount), the app captures a dated, structured **regimen-change record**. Markers
appear on adherence/blood-level/calendar visualisations at the change's date; a
tap/click opens the details of what changed; multiple changes on the same day are
**grouped** into one marker.

> Worked example: on 12 June the user raises Lamotrigine's standard morning dose
> from 100 mg to 150 mg and adds an evening slot. Two changes are recorded for
> that day. The adherence chart shows a single grouped marker on 12 June; tapping
> it reveals "Lamotrigine morning dose 100 mg → 150 mg" and "Added 20:00 Evening
> slot (Lamotrigine 150 mg)".

## 2. Scope
**In:** one new syncable entity — **`RegimenChange`** — capturing a change at a
UTC `Instant` with the active zone, a coarse `kind`, the affected medication
and/or slot ids, a human-readable `summary`, and a structured list of
**field-level diffs** (`field`, `from`, `to`); pure-core helpers that **derive**
a `RegimenChange` by diffing the previous vs next entity in the relevant store
actions; full persistence + **cloud sync** (records table, validator, RLS,
`push_records`, pgTAP) consistent with every other entity; a reusable
**timeline-marker** layer rendered on the existing charts, with same-day grouping
and a change-detail popover; JSON export/import round-trip; a history/list view of
changes.
**Out:** editing or back-dating a change record by hand (changes are derived from
real edits, not authored); diffing arbitrary historical states; automatic
clinical interpretation of a change; correlating changes with outcomes
statistically (markers enable the eyeball view; stats are later). The app never
*originates* a regimen change — it records the edits the user makes.

## 3. Prerequisites
- The Stage 4/5/8 record envelope (`core/cloudRecord.ts`), sync mapping
  (`sync/recordMapping.ts`), `LocalRepository`, and the Supabase `records` table +
  `validate_record` / `push_records`.
- The timezone rule (`core/time.ts`): the change is a UTC `Instant`; the zone in
  effect when made is stored for stable date placement on charts.
- The existing chart components (`ui/components/AdherenceChart.tsx`,
  `BloodLevelChart.tsx`) and the day calendar (`ui/screens/CalendarScreen.tsx`)
  that the marker layer attaches to.
- The mutating store actions that are the change sources: `addMedication` /
  `updateMedication` / `setMedicationActive` (or equivalent) and the slot actions
  (`addSlot` / `updateSlot` / `removeSlot`) in `store/store.ts`.

## 4. Data model
One new syncable entity, mirroring the envelope conventions (`id` / `updatedAt` /
optional `version` / `deleted`):

```ts
// What kind of regimen edit this records. Coarse, for marker styling + filtering.
type RegimenChangeKind =
  | 'medication-added'
  | 'medication-updated'    // name, dose defaults, guardrails, half-life, notes
  | 'medication-retired'    // active → false (or deleted)
  | 'slot-added'
  | 'slot-updated'          // time, label, or a per-med amount in the slot
  | 'slot-removed';

// One concrete field that changed, in display-ready form. `from`/`to` are
// pre-formatted strings (e.g. "100mg", "08:00", "—") so rendering needs no schema.
interface RegimenFieldChange {
  field: string;            // e.g. "Morning dose", "Name", "Max single dose", "Time"
  from: string | null;      // null = newly set / not previously present
  to: string | null;        // null = cleared / removed
}

interface RegimenChange {
  id: string;
  changedAt: Instant;       // when the edit happened (UTC ms)
  zone: IanaZone;           // zone in effect when changed (stable date placement)
  kind: RegimenChangeKind;
  medId?: string;           // affected medication, when applicable
  slotId?: string;          // affected slot, when applicable
  summary: string;          // one-line human summary, e.g. "Lamotrigine 100mg → 150mg"
  changes: RegimenFieldChange[]; // the field-level diff (≥ 1)
  note?: string;            // optional free-text the user can add to the change
  updatedAt: Instant; version?: number; deleted?: boolean;
}
```

- `changedAt` is the event time used to place the marker on a day; `updatedAt` is
  sync metadata. They are equal at creation but diverge if the user later edits the
  change's `note` (or soft-deletes it).
- Diff values are **formatted at capture time** using the same display helpers the
  UI uses (dose+unit, wall-time), so a marker renders without re-resolving entities
  — and so the record reads correctly even after the medication is later renamed.
- Added to `Dataset.regimenChanges`, `RecordType` (`'regimenChange'`),
  `RECORD_TYPES`, the sync table map (`regimenChanges` ↔ `regimenChange`),
  `Repository.TableName`, and a new Dexie store (structural version bump).

## 5. Functional requirements
- FR-16.1. **Capture prescription changes.** Editing a medication's prescription —
  name, standard dose for a slot, unit, half-life, guardrails, notes — records a
  `RegimenChange` (`kind: 'medication-updated'`) whose `changes` list the fields
  that actually differ (no-op edits record nothing). Introducing a new medication
  records `'medication-added'`; retiring one (active → false / delete) records
  `'medication-retired'`.
- FR-16.2. **Capture schedule changes.** Adding a time-slot records `'slot-added'`;
  removing one records `'slot-removed'`; changing a slot's time, label, or a
  medication's amount within the slot records `'slot-updated'` with the specific
  field diffs.
- FR-16.3. **Derive, don't author.** Each change is derived by diffing the previous
  vs next entity inside the store action that performs the edit — the user never
  fills in a change form. Diffing is **pure core** (`core/regimenChanges.ts`),
  unit-tested, and returns `null` when nothing meaningful changed.
- FR-16.4. **Markers on visualisations.** The adherence chart, blood-level chart,
  and day calendar render a marker at each change's local date. The marker is
  styled by `kind` and is keyboard-focusable and screen-reader labelled with its
  summary.
- FR-16.5. **Tap for details.** Activating a marker (click/tap/Enter) opens a
  popover/sheet listing the change(s): kind, affected medication/slot, the
  `summary`, and the field-level `from → to` diffs, plus the local date/time.
- FR-16.6. **Group same-day changes.** All non-deleted changes that fall on the
  same local calendar day (in the active zone) render as **one** marker; its
  detail view lists each change in time order. The marker indicates the count
  (e.g. a "3" badge) when more than one.
- FR-16.7. **Synced + portable.** Regimen changes sync via the same push/pull/LWW
  path as other records, validate structurally and identically on client and
  server, round-trip through JSON export/import, and can be soft-deleted
  (tombstone) and annotated with a `note`.

## 6. Technical approach
- **Core (pure):** `core/regimenChanges.ts` —
  - `diffMedication(prev, next, slots)` and `diffSlot(prev, next, meds)` →
    `RegimenFieldChange[]` (empty = no change), using `core` display helpers
    (dose+unit, `wallTimeInZone`) to format `from`/`to`.
  - `buildRegimenChange(kind, { medId?, slotId?, changes, now, zone })` →
    `RegimenChange` (id via `core/ids.ts`, `summary` composed from the diff).
  - `groupChangesByDay(changes, zone)` → ordered groups keyed by `ISODate`, each
    sorted by `changedAt`; the marker layer and detail view consume this.
- **Validation envelope:** add a `validateRegimenChange` branch to
  `core/cloudRecord.ts` (structural: `changedAt`/`zone`/`kind` enum/`summary`/
  `changes` array shape) and a matching branch to `validate_record` (plpgsql),
  kept in lock-step with a pgTAP parity test. `record_type` gains `'regimenChange'`.
- **Sync/store/repo:** extend the table↔type maps, `TableName`, the Dexie schema
  (structural version bump), `loadAll`/`persistDataset`/`TABLES`, and `transfer.ts`
  (validate/merge, default `[]` for older files).
- **Store actions:** the medication and slot mutators compute the diff against the
  pre-edit entity and, when non-empty, append a derived `RegimenChange` (and queue
  it for sync) in the same transaction as the edit. A small `recordRegimenChange`
  helper centralises id/stamp/persist. Hydrate/reload/import wiring included.
- **UI:**
  - `ui/components/ChangeMarkers.tsx` — a presentational marker layer positioned by
    date over a chart's x-axis (reused by adherence + blood-level), plus a
    `ChangeDetail` popover. Consumes `groupChangesByDay`.
  - Wire markers into `AdherenceChart` / `BloodLevelChart` (accept an optional
    `changes` prop) and the day calendar (a header chip on days with changes).
  - A **Changes** list in the History screen: reverse-chronological grouped
    changes with their diffs; allows adding a `note` or deleting a change.
- **Seed:** the first-run seed adds one example change a few days back so the
  marker UI is visible in the demo dataset.

## 7. Tasks
1. `core/types.ts`: add `RegimenChange` + `RegimenChangeKind` +
   `RegimenFieldChange` (+ `Dataset.regimenChanges`).
2. `core/regimenChanges.ts` (+ test): `diffMedication`, `diffSlot`,
   `buildRegimenChange`, `groupChangesByDay`.
3. `core/cloudRecord.ts`: `RecordType` + `RECORD_TYPES` + `validateRegimenChange`.
4. `sync/recordMapping.ts` + `store/repository.ts`: table/type maps + `TableName`.
5. `store/localRepository.ts`: new Dexie store; include in
   `loadAll`/`persistDataset`/`TABLES`/first-run check.
6. `store/transfer.ts`: validate/merge changes (default `[]` for old files).
7. `store/store.ts`: emit derived changes from medication + slot actions; hydrate/
   reload/import wiring; `addChangeNote` / `deleteChange` actions.
8. `store/seed.ts`: seed one example change.
9. `ui/components/ChangeMarkers.tsx` (+ `ChangeDetail`); wire into `AdherenceChart`,
   `BloodLevelChart`, the calendar, and a Changes list in `HistoryScreen`.
10. Supabase: migration extending the enum + `validate_record`; pgTAP parity +
    push/LWW test (`supabase/tests/regimen_change_test.sql`).

## 8. Acceptance criteria
- AC1. Raising a slot's Lamotrigine dose from 100 mg to 150 mg records one
  `medication-updated`/`slot-updated` change whose diff reads "100mg → 150mg"; a
  no-op save records nothing.
- AC2. Adding a 20:00 Evening slot records a `slot-added` change; removing a slot
  records `slot-removed`; both carry the affected slot id and a readable summary.
- AC3. The adherence and blood-level charts show a marker on the change's local
  date; the marker is focusable and labelled with its summary.
- AC4. Two changes made on the same day render as a single grouped marker showing a
  count; its detail view lists both in time order.
- AC5. Activating a marker opens a detail view listing each change's kind, summary,
  and `from → to` field diffs with the local date/time.
- AC6. Regimen changes round-trip through JSON export → import and survive a
  soft-delete tombstone.
- AC7. `validate_record` accepts a valid `regimenChange` and rejects malformed ones,
  matching `validateSyncRecord` (pgTAP); a pushed change obeys the LWW guard and
  RLS scopes it to the owner.

## 9. Test plan
- Unit: `diffMedication` / `diffSlot` (changed vs unchanged fields, formatting,
  cleared/added values); `buildRegimenChange` summary composition;
  `groupChangesByDay` (same-day grouping + ordering, zone boundaries);
  `validateRegimenChange` envelope; record-mapping round-trip; transfer merge;
  store actions emit exactly one change per meaningful edit and none for no-ops.
- Component: marker layer positions one marker per day and renders the count badge;
  the detail popover lists grouped diffs; charts render with and without changes.
- pgTAP: `validate_record` parity; push accept/stale; RLS owner-scoping.
- (E2E, optional) edit a dose + add a slot on the same day, assert one grouped
  marker on the chart and the synced rows.

## 10. Risks / decisions
- **Safety:** changes only ever *record* user edits and formatted prior/next
  values; the app never originates a regimen change or a dose value (PRD safety
  invariant).
- **Derive at the edit site:** capturing the diff inside the store action (with the
  pre-edit entity in hand) is simpler and more accurate than reconstructing history
  from `updatedAt`/`version` later, and keeps the pure diff logic in core.
- **Formatted-at-capture values:** storing display strings (not raw values) keeps a
  marker readable after later renames/edits and lets the SQL validator stay
  structural; the trade-off is diffs are not machine-re-aggregatable later (out of
  scope, acceptable).
- **Schema drift:** TS and SQL validators stay in lock-step — the pgTAP parity test
  guards it (same pattern as Stages 8/12/15).
- **Marker density:** same-day grouping (FR-16.6) bounds marker count to one per
  day; further clustering (e.g. weekly zoom) is deferred.
- **Enum migration:** adding a `record_type` value is forward-only
  (`alter type … add value if not exists` + re-defined `validate_record`).

## 11. Definition of done
All ACs pass; meaningful prescription and schedule edits are captured as derived,
synced, portable `RegimenChange` records; the timeline charts and calendar show
date-placed, same-day-grouped, tappable markers whose detail view explains exactly
what changed; everything validates identically on client and server like every
other record.
