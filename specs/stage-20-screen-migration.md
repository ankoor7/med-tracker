# Stage 20 Spec — Screen Migration (forms, lists, chrome)

| | |
|---|---|
| **Depends on** | Stage 19 (the primitive library + theme must exist) |
| **Implements** | FR-20.1 … FR-20.6 |
| **Milestone** | F (UI system rewrite) |
| **Status** | Draft |

## 1. Objective
Migrate the app's **form, list, and chrome** surfaces onto the Stage 19 primitives
and theme, with **behaviour parity** — every Stage 18 fix must survive the rewrite.
The dashboards and calendar are deliberately excluded; they are Stage 21, where the
legibility bar is the whole point.

## 2. Scope
**In** — migrate onto React Aria Components + the new theme:
- **App chrome:** the shell and bottom nav in `App.tsx` (5 tabs after FR-18.12),
  using `Tabs`/`ToggleButton`; the disclaimer, catch-up banner, sync indicator.
- **Today** (`TodayScreen.tsx`): the dose list, the summary card, the FR-18.6
  assumed-vs-logged disclosure and stat tiles.
- **Meds** (`MedsScreen.tsx`, `MedicationEditor.tsx`, `SlotEditor.tsx`): the merged
  FR-18.12 editor and both projections, using `Select`/`ComboBox`/`NumberField`/
  `TimeField`/`Form`.
- **Events** (`EventsScreen.tsx`).
- **The logging dialogs** (`DoseLogger.tsx`, `GroupLogger.tsx`, `StartDatePrompt.tsx`,
  `StartDateField.tsx`) on `Dialog`/`Modal` with `NumberField`/`DateField`/
  `TimeField` and the FR-18.5 confirmation pattern (`ConfirmDialog` from Stage 19).
- Panels: `AccountPanel`, `RemindersPanel`, `DataTransferPanel`, `OuraPanel`.
- Delete the custom CSS and dead markup each migrated surface leaves behind.

**Out:**
- `CalendarScreen.tsx`, `HistoryScreen.tsx`, `AdherenceChart.tsx`,
  `OuraCorrelationChart.tsx`, `ChangeMarkers.tsx` — Stage 21.
- Any behaviour change. Any change to `src/core`, `src/store`, `src/sync`.

## 3. Functional requirements
- **FR-20.1** Every in-scope screen/component renders on the Stage 19 primitives
  and theme; the custom CSS and hand-rolled interaction code they replace is removed.
- **FR-20.2 (behaviour parity — the load-bearing requirement).** No Stage 18
  behaviour regresses. Specifically, still holding after the rewrite:
  FR-18.2 dose edit/delete from Today; FR-18.3 skip; FR-18.4 lateness display;
  FR-18.5 destructive-action confirmations and "Stop taking"; FR-18.6 assumed-vs-
  logged distinction (including the **non-colour** cue and accessible names);
  FR-18.7/18.8 editor validation; FR-18.12 merged editor, both projections, the
  shared-time disclosure, and AC14 change records unchanged in kind and content.
- **FR-20.3** The existing screen tests (`TodayScreen.test.tsx`,
  `MedsScreen.test.tsx`, `StartDatePrompt.test.tsx`, …) are migrated to the new DOM
  and, where a pattern tester fits, to `@react-aria/test-utils` — not deleted. Their
  assertions encode real behaviour (the Stage 18 confirmations and validations).
- **FR-20.4** Forms use React Aria's `Form`/field validation wiring, so the FR-18.8
  validations (duplicate names, non-negative numerics, daily-total vs cap) surface
  as accessible field errors, not ad-hoc text.
- **FR-20.5** Keyboard-operable and screen-reader-labelled throughout; visible focus.
- **FR-20.6** No change to `src/core`, `src/store`, `src/sync`.

## 4. Acceptance criteria
- **AC20.1** Each in-scope surface renders on the new system; grep finds no
  leftover custom CSS/markup for a migrated component.
- **AC20.2** A regression pass (live + tests) confirms every FR-18.x behaviour in
  FR-20.2 still holds — this is validated in the running app, not only in tests.
- **AC20.3** Migrated forms show validation errors through the accessible field
  mechanism.
- **AC20.4** `src/core`, `src/store`, `src/sync` byte-unchanged.

## 5. Prerequisites
- Stage 19 primitive library + theme + theme guide.
- The Stage 18 test suite as the behaviour-parity oracle — run it continuously.

## 6. Notes
Migrate screen-by-screen, committing each so a regression is bisectable. The
merged editor (`MedicationEditor`/`SlotEditor`) is the riskiest surface — it holds
the FR-18.12 planner wiring and the FR-18.8 validations — so migrate it on its own
with a full pipeline pass.
