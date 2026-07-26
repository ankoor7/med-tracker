# Stage 24 Spec — Occurrence-Linked Side-Effect Logging

| | |
|---|---|
| **Depends on** | Stage 1 (core), Stage 2 (persistence), Stage 15 (event system), Stages 4/5/8 (records + sync), Stage 23 (side-effects feed the clinician summary) |
| **Implements** | FR-24.1 … FR-24.7 · closes **P0 #5** (`specs/p0-feature-audit.md`) |
| **Milestone** | Post-release P0 hardening |
| **Status** | Ready |

## 1. Objective
Let a patient log a **side effect** and tie it to the medication (and optionally
the specific dose occurrence) they attribute it to. This is the P0 the research
calls out as "what patients most want to convey" and the direct fuel for the
doctor conversation. Stage 15 already gives us a typed, synced event system
(`EventType` + `EventInstance`), but its instances are **standalone** — an
`EventInstance` has no reference to a medication or a dose. This stage adds that
linkage so side effects can be attributed, listed under a medication, and rolled
into the Stage 23 pre-visit summary.

> Worked example: after logging the 08:00 group the user feels drowsy. They tap
> **Log side effect → Drowsiness**, severity 3/5, and attribute it to
> "Levetiracetam" (optionally to that 08:00 dose). Later the medication's detail
> and the pre-visit summary both show "Drowsiness ×4 this period, attributed to
> Levetiracetam".

## 2. Scope
**In:**
- An **optional attribution** on `EventInstance`: `medId?` (the medication the user
  attributes the event to) and `doseLogEntryId?` (the specific logged occurrence,
  when the user logs a side effect from a dose). Both optional and additive — every
  existing event and the seizure/flare-up use case keep working unchanged.
- A lightweight way to mark an event type as a **side-effect kind** so the UI can
  offer a "Log side effect" affordance distinct from flare-ups, without hardcoding
  type names: an optional `category?: 'flare' | 'side-effect'` on `EventType`
  (absent = general/flare, preserving current behaviour).
- A **"Log side effect" affordance from a dose occurrence** (Today / history dose
  row) that pre-fills `medId` and `doseLogEntryId`.
- Pure-core validation that `medId`/`doseLogEntryId` reference existing records (or
  are absent); a resolver that lists a medication's attributed side effects.
- Full **persistence + cloud sync** (records validator, RLS, `push_records`,
  pgTAP) consistent with every other entity — the new fields ride the existing
  `EventInstance` record type; no new record type.
- **Feed into Stage 23**: attributed side effects appear in the pre-visit summary
  grouped by medication.

**Out:** a curated side-effect dictionary / MedDRA coding (free-text type names as
today); severity **scales** beyond the existing `scale` property type; any
inference of causation — attribution is the **user's stated** association, never a
computed or implied one (surface, don't interpret); auto-suggesting which med
caused an effect.

## 3. Prerequisites
- Stage 15 `EventType` / `EventInstance` (`src/core/events.ts`, `types.ts`), their
  persistence, sync mapping (`core/cloudRecord.ts`), and pgTAP validator.
- Stage 23 report builder (to consume attributed side effects) — Stage 24's summary
  hook lands only if 23 is present; otherwise the linkage + UI still ship.

## 4. Data-model changes
Additive, all optional (`src/core/types.ts`):

```ts
// On EventType:
category?: 'flare' | 'side-effect'; // absent = general/flare (current behaviour)

// On EventInstance — user-stated attribution (Stage 24, P0 #5):
medId?: string;          // medication the user attributes this event to
doseLogEntryId?: string; // the specific logged occurrence, when logged from a dose
```

- Absent fields = unattributed, exactly as today. A `doseLogEntryId` implies a
  `medId` (the dose's med); the resolver derives/validates consistency.
- The cloud `EventInstance` record payload gains the optional fields; the SQL
  validator accepts them as optional strings; no migration to a new table.

## 5. Functional requirements
- **FR-24.1** — An `EventType` may be marked `category: 'side-effect'`; the type
  editor exposes this. Absent stays general/flare.
- **FR-24.2** — Logging an `EventInstance` may set `medId` (pick from active meds)
  and, when initiated from a dose, `doseLogEntryId`. Both optional.
- **FR-24.3** — A **"Log side effect"** action on a Today/history dose row opens the
  event logger pre-filled with that dose's `medId` + `doseLogEntryId` and the
  side-effect types.
- **FR-24.4** — Pure-core validation: if present, `medId`/`doseLogEntryId` must
  reference an existing (non-deleted) medication / dose-log entry; a
  `doseLogEntryId` whose med disagrees with `medId` is rejected.
- **FR-24.5** — A resolver `sideEffectsForMedication(dataset, medId, window?)`
  returns the attributed events (respecting archival/deletion), for the med detail
  view and the summary.
- **FR-24.6** — Full persistence + cloud sync of the new fields, with pgTAP
  coverage asserting the validator accepts attributed instances and rejects a
  dangling reference. JSON export/import round-trips the fields.
- **FR-24.7** — When Stage 23 is present, attributed side effects appear in the
  pre-visit summary grouped by medication (counts + severity summary), labelled as
  **user-attributed**, non-prescriptive.

## 6. Acceptance criteria
- **AC1** — Creating a "Drowsiness" side-effect type, logging it attributed to a
  med, and reopening shows the attribution retained.
- **AC2** — "Log side effect" from an 08:00 dose row pre-fills that med + occurrence;
  the saved instance carries both ids.
- **AC3** — A pre-Stage-24 event (no attribution) still loads, renders, and syncs
  unchanged; export/import preserves absence.
- **AC4** — Core validation rejects a `medId`/`doseLogEntryId` that references a
  missing or mismatched record (mutation-proven against the resolver).
- **AC5** — `sideEffectsForMedication()` returns exactly the attributed, non-deleted
  events in-window; covered by unit tests.
- **AC6** — pgTAP: an attributed instance passes `validate_record`; a dangling
  reference is handled per the validator's contract (documented in the spec's DB
  section). Sync round-trips the fields.
- **AC7** — With Stage 23 present, an attributed side effect appears under its med
  in the summary; copy contains no causal/prescriptive claim.

## 7. Open questions
- Should the DB validator **hard-reject** a dangling `medId` (referential integrity
  across record types is awkward in the current single-table design), or accept it
  and let the client resolver treat unresolved references as unattributed? Current
  call: **client resolver is authoritative** (accept optional strings server-side,
  resolve/ignore dangling client-side), matching how the app already handles
  cross-entity references. Confirm during implementation.
- Do side effects need their own **timeline/history filter** separate from
  flare-ups? Deferred — the `category` field makes it cheap to add later.
