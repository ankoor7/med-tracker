# Stage 22 Spec — Medication Identity Metadata (strength, form)

| | |
|---|---|
| **Depends on** | Stage 1 (core `Medication`), Stage 2 (persistence + migrations), Stage 20 (Meds editor on React Aria) |
| **Implements** | FR-22.1 … FR-22.4 · closes **P0 #3** (`specs/p0-feature-audit.md`) |
| **Milestone** | Post-release P0 hardening |
| **Status** | Done |

## 1. Objective
Complete the per-medication identity metadata that P0 #3 calls for. Today a
`Medication` carries name, colour, dose unit, half-life, notes, active, guardrails,
`startedAt`, and the `adjustWhenLate` timing-sensitive flag (FR-MED-2) — but **no
product strength and no dosage form**. A patient's medication is identified in the
real world as e.g. "Levetiracetam **500 mg tablet**": strength and form are what
make a medication list recognisable to a clinician or pharmacist. This stage adds
those two fields to the model, the editor, and export/import.

This is a deliberately small stage; it is the **prerequisite for the portable
medication list in Stage 23**, which renders "name · strength · form".

> Worked example: the user edits "Levetiracetam", sets **Strength** = "500 mg" and
> **Form** = "Tablet". The Meds list and every downstream med list / clinician
> output now read "Levetiracetam 500 mg — Tablet" instead of a bare name.

## 2. Scope
**In:** two new optional `Medication` fields — `strength` (free text, e.g.
"500 mg", "5 mg/mL") and `form` (a small enumerated set with an "Other" escape
hatch); pure-core validation (length caps, trimming) folded into the existing
`validateMedication()`; the Meds editor fields (React Aria `TextField` +
`Select`); a Dexie migration that is a pure add (existing rows read the fields as
`undefined`); JSON export/import round-trip; a display helper
(`medicationLabel(med)`) reused by the Meds screen and later stages.

**Out:** a drug database / autocomplete or barcode lookup (that is P2 —
"barcode/database-assisted entry"); NDC/DIN codes; linking strength to the
scheduled dose arithmetic (strength is descriptive metadata only — it never feeds
dose calculation, holding the surface-don't-interpret guardrail); per-slot form.

## 3. Prerequisites
- Stage 1 `Medication` type and `validateMedication()` in
  `src/core/medicationValidation.ts`.
- Stage 2 Dexie schema + the numbered migration mechanism (`src/store` /
  `migrations.ts`); latest migration is 0010.
- Stage 20 Meds editor already on React Aria `Form`/`Select`/`TextField`.

## 4. Data-model changes
Add to `Medication` (`src/core/types.ts`), both **optional** for back-compat:

```ts
// Descriptive product identity (Stage 22, P0 #3). Never feeds dose arithmetic.
strength?: string;      // free text as printed on the pack, e.g. "500 mg", "5 mg/mL"
form?: MedicationForm;  // dosage form; `MedicationForm` below
```

```ts
export type MedicationForm =
  | 'tablet' | 'capsule' | 'liquid' | 'injection'
  | 'patch'  | 'inhaler' | 'drops'  | 'cream' | 'other';
```

- A row written before this stage has both `undefined`; the app treats an absent
  value as "not specified" and renders the bare name — **no behavioural change**
  for existing data.
- `strength` is display metadata; it is distinct from `unit` (the dose unit used
  for logging/guardrails) and from the scheduled `dose`. It is never parsed.

## 5. Functional requirements
- **FR-22.1** — Create/edit a medication with an optional **strength** (free text)
  and optional **form** (chosen from `MedicationForm`; "Other" allowed).
- **FR-22.2** — `validateMedication()` accepts both fields, trims `strength`, caps
  its length (e.g. ≤ 40 chars) with an accessible `FieldError`, and treats empty
  as "not specified" (stored as `undefined`, not `""`).
- **FR-22.3** — A shared `medicationLabel(med)` core helper renders a single
  human string: `name` + ` <strength>` when present + ` — <Form>` when present
  (form title-cased; "other" omitted). Used by the Meds list now and by Stage 23.
- **FR-22.4** — JSON export includes the fields; import round-trips them; a
  Dexie migration adds them as a pure, non-destructive column add.

## 6. Acceptance criteria
- **AC1** — Editing a med, setting strength "500 mg" + form "Tablet", saving, and
  reopening shows both retained; the Meds list shows "… 500 mg — Tablet".
- **AC2** — A pre-existing med (no strength/form) still saves and renders its bare
  name with no error; upgrading a pre-Stage-22 DB does not lose or alter data.
- **AC3** — `validateMedication()` rejects an over-long strength with an accessible
  error and stores a blank strength as `undefined`. (Mutation-proven: reverting the
  cap/trim turns the new core test red.)
- **AC4** — Export → wipe → import restores strength and form exactly.
- **AC5** — `medicationLabel()` output is covered by unit tests for all four
  combinations (name only / +strength / +form / +both) and the "other" form case.

## 7. Open questions
- Should `form` be fully free-text instead of enumerated? Current call: enumerate
  with an "Other" bucket for a clean, filterable med list; revisit if the fixed set
  proves too narrow.
