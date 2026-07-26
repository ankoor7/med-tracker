# Stage 12 Spec — Next-Dose Override (one-time, synced)

| | |
|---|---|
| **Depends on** | Stage 1 (schedule/core), Stage 2 (persistence), Stages 4/5/8 (records + sync + Supabase) |
| **Implements** | FR-12.1 … FR-12.6 |
| **Milestone** | C (daily-driver polish) |
| **Status** | Done |

## 1. Objective
Support the real-world late-dose workflow end-to-end: when a scheduled dose is
taken late at an **adjusted amount**, let the user — in the same flow — set a
**one-time new amount for the next scheduled dose**, without permanently changing
the recurring schedule.

> Worked example: the 08:00 dose is missed; at 10:30 the user calculates a smaller
> catch-up amount and records "08:00 dose taken at 10:30, adjusted to X". Because
> they took it late, they also want the next scheduled dose (say 20:00) to be a
> different amount Y this once. The 20:00 slot's normal dose is unchanged for every
> other day.

## 2. Scope
**In:** a new **`DoseOverride`** entity — a one-time planned dose for a single
future occurrence; a follow-up step in `DoseLogger` to set it; Today reflecting the
override; full persistence and **cloud sync** (records table, validator, RLS,
`push_records`, pgTAP) consistent with every other entity.
**Out:** editing the recurring `Slot` dose (that already exists on the Schedule
tab); multi-occurrence/recurring overrides; auto-calculating the adjusted amount
(the app never originates a dose — the user enters it).

## 3. Prerequisites
- `core/schedule.ts` enumeration and `core/occurrence.ts` occurrence keying.
- The Stage 4/5/8 record envelope (`core/cloudRecord.ts`), sync mapping
  (`sync/recordMapping.ts`), `LocalRepository`, and the Supabase `records` table +
  `validate_record` / `push_records`.

## 4. Data model
A new syncable entity, mirroring the existing envelope conventions:

```ts
interface DoseOverride {
  id: string;
  slotId: string;          // the recurring slot whose occurrence is overridden
  medId: string;
  scheduledInstant: Instant; // the specific occurrence (UTC ms)
  zone: IanaZone;          // zone in effect when set (stable occurrence keying)
  dose: number;            // the one-time planned amount (> 0)
  note?: string;
  updatedAt: Instant; version?: number; deleted?: boolean;
}
```

- Added to `Dataset`, `RecordType` (`'doseOverride'`), `RECORD_TYPES`, the sync
  table maps (`doseOverrides` ↔ `doseOverride`), `Repository.TableName`, and a new
  Dexie store (structural version bump).
- Occurrence identity reuses the canonical key `(slotId, medId, localDate)` so an
  override survives a mid-day zone change exactly like a dose-log entry (FR-5.6).

## 5. Functional requirements
- FR-12.1. **Set from the logger.** After logging a dose, when the logged amount
  is **adjusted** or the dose is **late**, the logger offers "Adjust next {med}
  dose". Expanding it shows the next scheduled occurrence (time + normal dose) and
  an amount field defaulting to the just-logged adjusted amount.
- FR-12.2. **One-time only.** Saving creates/updates a `DoseOverride` for that one
  occurrence. The recurring slot's dose is unchanged for all other days.
- FR-12.3. **Today reflects it.** A future occurrence with an active override shows
  the override amount (not the slot's normal dose) and is flagged as adjusted; the
  `DoseLogger` for that occurrence pre-fills the override amount.
- FR-12.4. **Fulfilment.** When the overridden occurrence is later logged, the
  override is consumed (tombstoned) so it never lingers or re-applies.
- FR-12.5. **Guardrails.** The override amount runs through `checkGuardrails`
  (single-dose cap and, projected, daily cap); over-cap requires the same explicit
  confirmation the logger already uses. The app never originates the value.
- FR-12.6. **Synced + portable.** Overrides sync via the same push/pull/LWW path
  as other records, validate identically on client and server, and round-trip
  through JSON export/import.

## 6. Technical approach
- **Core (pure):**
  - `core/occurrence.ts`: `overrideMatchesOccurrence(override, slotId, medId,
    scheduledInstant, date)` — same key/tolerance logic as `entryMatchesOccurrence`.
  - `core/schedule.ts`: `plannedSlotsForDate(..., overrides = [])` applies the
    newest non-deleted matching override to an **untaken** occurrence, setting its
    `dose` and `overridden: true` / `overrideId`. Optional trailing param → no
    change to adherence/reminders/history call sites.
  - `core/schedule.ts`: `nextOccurrenceForMed(medId, afterInstant, slots,
    medications, zone)` — the next future occurrence (today/upcoming days) of the
    med strictly after `afterInstant`, used to target the override.
- **Validation:** add `validateDoseOverride` to `core/cloudRecord.ts` and a
  matching `doseOverride` branch to `validate_record` (plpgsql) — kept in
  lock-step; pgTAP parity test added. `record_type` enum gains `'doseOverride'`.
- **Store:** `setDoseOverride(input)` (create/update + persist), and consumption on
  `logDose` (tombstone a matching override). Include `doseOverrides` in
  hydrate/reload/import persistence.
- **UI:** an expandable "Adjust next dose" section in `DoseLogger`; Today's
  occurrence row shows the override amount + an "adjusted" marker.

## 7. Tasks
1. Add `DoseOverride` to `core/types.ts` (+ `Dataset`, `PlannedOccurrence` flags).
2. `core/occurrence.ts`: `overrideMatchesOccurrence`.
3. `core/schedule.ts`: apply overrides in `plannedSlotsForDate`; add
   `nextOccurrenceForMed`.
4. `core/cloudRecord.ts`: `RecordType` + `RECORD_TYPES` + `validateDoseOverride`.
5. `sync/recordMapping.ts` + `store/repository.ts`: table/type maps + `TableName`.
6. `store/localRepository.ts`: new Dexie store (version bump); include in
   `loadAll`/`persistDataset`/`TABLES`.
7. `store/transfer.ts`: validate/merge `doseOverrides` (default `[]` for old files).
8. `store/store.ts`: `doseOverrides` state, `setDoseOverride`, consumption in
   `logDose`, hydrate/reload/import wiring.
9. `DoseLogger.tsx`: the adjust-next-dose follow-up; Today shows the override.
10. Supabase: migration extending the enum + `validate_record`; pgTAP parity +
    push/LWW test.

## 8. Acceptance criteria
- AC1. Logging an adjusted or late dose reveals "Adjust next {med} dose" showing the
  correct next occurrence and normal dose.
- AC2. Saving an override makes Today's next occurrence show amount Y (flagged
  adjusted); the recurring slot and all other days still show the normal dose.
- AC3. Opening the logger on the overridden occurrence pre-fills amount Y.
- AC4. Logging the overridden occurrence consumes the override (it does not
  re-appear).
- AC5. An over-cap override amount requires explicit confirmation (guardrails run).
- AC6. An override round-trips through JSON export → import.
- AC7. `validate_record` accepts a valid `doseOverride` and rejects a malformed one,
  matching `validateSyncRecord` (pgTAP); a pushed override obeys the LWW guard.

## 9. Test plan
- Unit: `overrideMatchesOccurrence`; `plannedSlotsForDate` override application +
  fulfilment; `nextOccurrenceForMed`; `validateDoseOverride`; record mapping
  round-trip; transfer merge.
- pgTAP: `validate_record` parity for `doseOverride`; push accept/stale.
- E2E (Playwright, optional in CI): the worked example — log 08:00 late + adjusted,
  set next dose, assert Today and the synced row.

## 10. Risks / decisions
- **Safety:** the override amount is always user-entered and guardrail-checked; the
  app never computes a dose (PRD safety invariant).
- **Schema drift:** TS and SQL validators must stay in lock-step — pgTAP parity
  test guards it (same pattern as Stage 8).
- **Enum migration:** adding a `record_type` value is forward-only; the migration
  uses `alter type … add value` (idempotent guard) and is applied via the normal
  `db push`.

## 11. Definition of done
All ACs pass; a one-time next-dose override can be set from the logger, shows on
Today, pre-fills and is consumed on logging, is guardrail-checked, syncs and
exports like every other record, and is validated identically on client and server.
