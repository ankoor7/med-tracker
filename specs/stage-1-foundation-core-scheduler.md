# Stage 1 Spec — Foundation & Core Scheduler

| | |
|---|---|
| **Depends on** | Stage 0 |
| **Implements** | FR-MED-\*, FR-SCH-\*, FR-LOG-\*, FR-GRD-\*, FR-TZ-\*, FR-HIS-1..3, extension interface |
| **Milestone** | A |
| **Status** | Ready |

## 1. Objective
Stand up the project and implement the **pure domain core** plus the **full UI** (Today / Schedule / Meds / History) over in-memory state. This is the hardened, typed, tested version of the existing prototype and the spine for all later stages. Decouple business logic from React so it can be unit-tested and reused.

## 2. Scope
**In:** repo + tooling; data model; schedule enumeration; guardrail validation; timezone math; adherence; all four screens; pharmacology extension interface (no-op default); sample data.
**Out:** persistence (Stage 2), cloud/auth (Stage 3), encryption (Stage 4), sync (Stage 5), real notifications (Stage 6), charts/export (Stage 7).

## 3. Prerequisites
None.

## 4. Functional requirements
Implement, per the PRD: FR-MED-1..4, FR-SCH-1..4, FR-LOG-1..6, FR-GRD-1..3, FR-TZ-1..4, FR-HIS-1..3. Use the canonical types in `02-architecture.md` §5.

## 5. Technical approach
- **Stack:** React + TypeScript + Vite; `vite-plugin-pwa` scaffolded (manifest + SW registration, caching can be minimal here); Tailwind; Zustand for the store; Vitest + Testing Library; ESLint + Prettier; GitHub Actions CI (typecheck, lint, test, build).
- **Module layout:**
  - `src/core/` — pure TS: `types.ts`, `time.ts` (offset/zone conversion, two-pass DST-safe), `schedule.ts` (`plannedSlotsForDate`), `guardrails.ts` (`checkGuardrails`), `adherence.ts`, `pharmacology.ts` (`DoseAdjustmentStrategy`, no-op default). **No React imports in `core/`.**
  - `src/store/` — Zustand store wrapping an in-memory dataset; actions for meds/slots/log/settings.
  - `src/ui/` — screens and components; presentation only.
- **Extension interface:** as in architecture §11; default export `noopStrategy`.
- **Guardrails:** single `checkGuardrails(med, dose, atInstant, log, zone): string[]` reused by manual logging, take-group, and suggestions.
- **Timezone:** store instants UTC; resolve wall-times in the active zone; never use the host zone implicitly.

## 6. Tasks
1. Confirm the Stage 0 shell is in place (scaffold, tooling, CI, Tailwind, PWA baseline already done); pull the `core/`-no-React lint rule into effect.
2. Implement `core/types.ts` and `core/time.ts` with tests (incl. DST cases).
3. Implement `core/schedule.ts`, `core/guardrails.ts`, `core/adherence.ts`, `core/pharmacology.ts` with tests.
4. Build Zustand store + actions over in-memory seed data.
5. Build UI: Today (grouped slots, take-group + single, partial), Schedule builder (slots + items), Meds library (half-life, guardrails, timing-sensitive), History (log + adherence + missed warning).
6. Add logger (editable adjusted dose + time, cap warnings, optional extension fill).
7. Add disclaimers and the extension boundary note.

## 7. Acceptance criteria
- AC1. Given a slot at 08:00 grouping three meds, when the day renders, Today shows one 08:00 group with three items.
- AC2. Given an upcoming group, when "take whole group" is tapped, all items log at normal dose and time≈now.
- AC3. Given a single late med, when logged with a different dose, the entry is marked `adjusted` and stores actual time/zone.
- AC4. Given a logged dose above `maxSingleDose`, the user must confirm and the entry is flagged with a warning.
- AC5. Given a partial group (one item taken), the slot shows remaining items still due.
- AC6. Given a med with `adjustWhenLate=false`, when it is past and untaken, it is not counted as "missed" and not styled as an alert.
- AC7. Given the active zone is Europe/London, when rendered on a BST date, times show "BST"; on a GMT date, "GMT".
- AC8. Given the BST→GMT (or →BST) transition, the real interval between the evening and next-morning dose is computed correctly (test).
- AC9. `core/` has no React import (enforced by lint rule or test).
- AC10. CI passes: typecheck, lint, tests, build.

## 8. Test plan
- Unit: time/zone conversion incl. two DST boundaries; schedule enumeration; guardrail combinations; adherence windowing (timing-sensitive only).
- Component: take-group, single log, partial group, cap-confirm flow.
- Lint/test guard: no React in `core/`.

## 9. Risks / decisions
- Keep `core/` framework-agnostic to enable reuse and isolated testing.
- Datetime-local inputs are interpreted in the **active app zone**, not the host zone — implement a helper and test it.

## 10. Definition of done
All ACs pass as tests; FRs mapped; CI green; the four screens usable over in-memory data; extension interface present with no-op default.
