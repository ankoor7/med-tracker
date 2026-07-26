# Stage 21 Spec — Dashboards & Calendar (the legibility bar)

| | |
|---|---|
| **Depends on** | Stage 19 (primitives + theme), Stage 20 (chrome + forms migrated) |
| **Implements** | FR-21.1 … FR-21.7 |
| **Milestone** | F (UI system rewrite) |
| **Status** | Partial — FR-21.1–21.7 implemented (Unit 1 History+charts `5252bde`, Unit 2 Calendar `4951cd6`); AC21.2 (live legibility judgement) and AC21.4 (live gesture re-check) still need human sign-off |

## 1. Objective
Bring the **data-visualisation surfaces** — the History adherence dashboards and
the Calendar — onto the new minimalistic theme, with **legibility as the explicit
acceptance bar**. This is the stage the user cares about most: "a minimalistic,
clean theme that lends itself to **easily understood dashboards and calendars**."
A passing test suite is not the bar here; a patient understanding the screen at a
glance is.

## 2. Scope
**In:**
- **History** (`HistoryScreen.tsx`) and its charts (`AdherenceChart.tsx`,
  `ChangeMarkers.tsx`, `OuraCorrelationChart.tsx`): the adherence summary, the
  per-day chart, the regimen-change markers, the dose log, filters, settings, and
  export. Use React Aria `Meter`/`ProgressBar` for the adherence figures where they
  fit; keep the SVG charts but re-skin to the theme.
- **Calendar** (`CalendarScreen.tsx`): the day view, the dose groups, the drag and
  arrow-key re-time gesture. Evaluate React Aria's `Calendar`/`RangeCalendar` for
  any date-navigation affordance, but the per-day dose-timeline is bespoke and
  stays bespoke — re-skin it, do not force it into a date-picker.
- A **legibility pass**: clear hierarchy, generous whitespace, restrained colour,
  legible-at-a-glance status so a patient reads "what did I take, what did I miss,
  what changed" without decoding.

**Out:** any change to what the charts *compute* (`src/core/adherence.ts`,
`history.ts`, `scheduleHistory.ts`) — this is presentation. Any behaviour change to
the calendar gesture semantics.

## 3. Functional requirements
- **FR-21.1** History and Calendar render on the new theme with the Stage 19
  primitives; their custom CSS is removed.
- **FR-21.2 (legibility — the point of the stage).** Dashboards and calendar are
  legible at a glance: clear visual hierarchy, a patient can tell taken / late /
  missed / **assumed** / skipped apart immediately, and the regimen-change markers
  read clearly. Validated by a person judging the rendered screens, not only tests.
- **FR-21.3 (must-not-regress — visual distinctions carry behaviour).** The FR-18.6
  assumed-vs-logged distinction and the FR-18.9 missed/upcoming/assumed distinction
  **survive the re-theme, including their non-colour cues and accessible names** —
  a re-skin that collapses them back into colour-only would silently undo those FRs.
  The adherence chart's assumed-portion cue and the calendar's per-member glyphs
  must remain distinct and labelled.
- **FR-21.4 (must-not-regress — the calendar gesture).** Drag and arrow-key
  re-timing (Stage 13, carried through FR-18.9) still work, with visible focus and
  a keyboard path, after the re-skin.
- **FR-21.5** Charts stay theme-aware (light/dark) and respect
  `prefers-reduced-motion`; any hatch/texture cue remains visible at real sizes and
  in the printed/exported view.
- **FR-21.6** Existing chart/screen tests (`charts.test.tsx`,
  `HistoryScreen.test.tsx`, `CalendarScreen.test.tsx`, `ChangeMarkers.test.tsx`)
  migrate to the new DOM, not deleted.
- **FR-21.7** No change to `src/core`, `src/store`, `src/sync`.

## 4. Acceptance criteria
- **AC21.1** History and Calendar render on the new theme; no leftover custom CSS.
- **AC21.2** A legibility review (a person, on device, light and dark) confirms the
  five dose states are tellable apart at a glance and the dashboards read without
  decoding — recorded as the acceptance judgement, not a test.
- **AC21.3** FR-18.6 / FR-18.9 distinctions and their non-colour cues + accessible
  names survive; asserted in tests and confirmed live.
- **AC21.4** Calendar drag and arrow-key re-time still work, verified live.
- **AC21.5** `src/core`, `src/store`, `src/sync` byte-unchanged.

## 5. Prerequisites
- Stages 19–20 complete.
- The FR-18.6 and FR-18.9 tests as the oracle for the distinctions that must survive.

## 6. Notes
Highest-value, highest-visual-risk stage — do it last, when the theme has settled
across every other surface. The temptation to simplify a distinction into
"just colour" during a re-skin is exactly what FR-21.3 guards against.
