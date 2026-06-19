# Stage 13 Spec — Daily-Calendar Drag-to-Adjust Dose Times

| | |
|---|---|
| **Depends on** | Stage 1 (schedule/time/guardrails), Stage 2 (persistence), Stage 11 (5-min step / `roundInstantToStep`), Stage 12 (next-dose override) |
| **Implements** | FR-13.1 … FR-13.6 |
| **Milestone** | C (daily-driver polish) |
| **Status** | Ready |

## 1. Objective
When a dose is missed or taken off-schedule, give the user a **daily-calendar
view** where the day's dose events sit on a vertical time-of-day axis and can be
**dragged up/down to set a different time**. Dragging only ever moves a dose
*time* — never its amount — and reuses the existing dose-time / next-dose-override
machinery rather than adding a parallel path.

> Worked example: the 08:00 dose shows as "missed" on the calendar. The user
> actually took it at 09:35, so they drag the block from the 08:00 line down to
> ~09:35; on drop it opens the logger pre-filled to 09:35 (with the
> already-available adjust-next-dose follow-up). A dose already logged at 09:35
> can be nudged to 09:40 by dragging it in place — its `actualInstant` updates
> and guardrails are re-checked.

## 2. Scope
**In:** a new **Calendar** tab rendering the current day as a vertical axis;
draggable dose blocks with 5-minute snapping and a live time readout; committing
a dragged time (re-time a taken dose in place, or open the logger pre-filled for
an untaken occurrence); pure geometry/snap helpers in `core/`; keyboard
re-timing as an accessibility alternative.

**Out:** multi-day navigation / week view; resizing a block to change duration
(doses are instants, not ranges); changing a dose **amount** from the calendar
(that stays in the logger / Schedule tab); editing the recurring `Slot.time`
(the calendar moves a single occurrence, not the recurring schedule); a new
synced entity (re-timing reuses `DoseLogEntry.actualInstant`).

## 3. Prerequisites
- `core/time.ts`: `resolveWallTimeToInstant`, `wallTimeInZone`, `roundInstantToStep`,
  `TIME_STEP_MS`, `addDaysToIsoDate`.
- `core/schedule.ts`: `plannedSlotsForDate` (status-tagged, override-aware).
- The Stage 11/12 `DoseLogger` (which already clamps "time taken" to ≤ now and
  offers the next-dose override) and the `checkGuardrails` shared validator.

## 4. Data model
**No new entity.** The calendar reuses what already exists:
- **Taken** occurrences anchor at the existing `DoseLogEntry.actualInstant`;
  dragging commits a new `actualInstant` on that entry (synced like any edit).
- **Untaken** occurrences (upcoming / due / missed) anchor at their
  `scheduledInstant`; dragging chooses a "time taken" and routes into the
  logger, which creates the `DoseLogEntry` (and any `DoseOverride`) as today.

The day axis is geometry only — a pure mapping between UTC instants and pixels.

## 5. Functional requirements
- FR-13.1. **Vertical day view.** The Calendar tab shows the active day's
  scheduled/taken/adjusted dose events as blocks on a 24-hour time-of-day axis,
  positioned by time, with a "now" marker. Day bounds resolve in the **active
  zone**.
- FR-13.2. **Drag to re-time.** A block can be dragged up (earlier) / down
  (later). The live block position and a time label update continuously while
  dragging.
- FR-13.3. **Snap.** The dragged time snaps to a 5-minute grid
  (`TIME_STEP_MS`), reusing `roundInstantToStep`; a custom step is supported by
  the core helper.
- FR-13.4. **Commit on drop.** Dropping a **taken** dose commits the new
  `actualInstant` in place (`adjustDoseTime`). Dropping an **untaken** dose opens
  the logger pre-filled to the dragged time. A press with no movement is a tap,
  not a drag (taps on an untaken dose open the logger).
- FR-13.5. **Zone correctness.** Every wall-clock position/label resolves in the
  app's active zone (never the host zone). Instants stay UTC ms. A taken dose is
  clamped to not move into the future; the day's start/end resolve via
  `resolveWallTimeToInstant`.
- FR-13.6. **Safety.** The calendar never originates a dose value — it moves
  times only. Re-timing a taken dose re-runs `checkGuardrails` at the new time
  (the min-interval result can change) and stores the refreshed warnings;
  untaken drops flow through the logger's existing guardrail confirmation.

## 6. Technical approach
- **Core (pure, `core/calendar.ts`)** — geometry + drag math, no React:
  - `dayStartInstant(date, zone)` / `dayEndInstant(date, zone)` — midnight
    boundaries in the active zone (DST-correct: a spring-forward day spans 23h).
  - `instantToDayY(instant, dayStart, pxPerHour)` /
    `dayYToInstant(y, dayStart, pxPerHour)` — instant ⇄ pixel, by real elapsed ms.
  - `clampInstant(instant, min, max)`.
  - `resolveDraggedInstant({ originalInstant, deltaY, pxPerHour, min, max, stepMs })`
    — the heart of the gesture: pixel delta → ms → add to anchor → snap → clamp.
    Pure and unit-tested across DST.
- **Store (`store/store.ts`)** — `adjustDoseTime(id, actualInstant)`: re-time an
  existing log entry; re-validate the **unchanged** dose via `checkGuardrails`
  (excluding the entry itself from the history) and re-stamp/persist it.
- **UI (`ui/screens/CalendarScreen.tsx`)** — presentation + interaction only.
  Native **pointer events** with `setPointerCapture` (no drag-and-drop
  dependency — none is in the project, and minimal native handlers suffice).
  A live preview while dragging, greedy lane packing so concurrent doses sit
  side-by-side, a tap/drag threshold, and `ArrowUp`/`ArrowDown` keyboard
  re-timing for taken doses (a11y). Untaken drops/taps reuse `DoseLogger` via a
  new optional `LoggerTarget.actualInstant`.

## 7. Tasks
1. `core/calendar.ts` (+ barrel export) with the geometry/snap helpers and tests.
2. `store/store.ts`: `adjustDoseTime` (guardrail re-check, persist).
3. `DoseLogger`: optional `LoggerTarget.actualInstant`, seeding "time taken".
4. `ui/screens/CalendarScreen.tsx`: axis, blocks, pointer-drag, keyboard, logger
   wiring.
5. `App.tsx`: add the **Calendar** tab.

## 8. Acceptance criteria
- AC1. The Calendar tab renders the day's doses on a 24-hour axis with a "now"
  marker, blocks placed at the correct wall-clock position in the active zone.
- AC2. Dragging a block moves it and shows a live 5-minute-snapped time.
- AC3. Dropping a **taken** dose updates its `actualInstant` (and warnings); the
  block stays at the new time after release.
- AC4. Dropping an **untaken** dose opens the logger pre-filled to the dragged
  time (≤ now); logging then follows the normal Stage 11/12 flow.
- AC5. A taken dose cannot be dragged past "now"; no block can be dragged before
  the day's start.
- AC6. `resolveDraggedInstant` snaps and clamps correctly, including across a UK
  DST boundary (elapsed-ms based).

## 9. Test plan
- Unit (`core/calendar.test.ts`): day bounds in zone (24h vs 23h spring-forward);
  `instantToDayY`/`dayYToInstant` round-trip; `clampInstant`;
  `resolveDraggedInstant` (down/up, off-grid snap, clamp to start, clamp to
  "now"/max, custom step).
- Store (covered by existing patterns): `adjustDoseTime` moves the time, leaves
  the dose, and refreshes warnings (min-interval) — re-uses `checkGuardrails`.
- Manual/E2E (optional): drag a missed dose to log it; nudge a taken dose.

## 10. Risks / decisions
- **Reuse over new entity.** Re-timing edits `DoseLogEntry.actualInstant` and
  untaken drops route through the existing logger, so sync/validation/export are
  unchanged — no schema or `validate_record` work.
- **No drag library.** The project ships none; native pointer events with
  capture are enough and avoid a dependency.
- **DST rendering.** Blocks are positioned by real elapsed ms, so on a 23h/25h
  DST day the fixed 24-row axis is off by an hour past the transition; time
  labels (via `wallTimeInZone`) stay correct. Acceptable for a personal day view.
- **Safety invariant.** Dragging never changes an amount; guardrails always run
  through the shared `checkGuardrails`.

## 11. Open questions
- Multi-day / week navigation (currently today-only)?
- Should re-timing a taken dose past the min-interval require the same explicit
  over-cap confirmation the logger uses, or is storing the warning enough (as a
  pure time edit cannot change the amount)?
- Should dragging an upcoming (future) dose be disallowed entirely, vs. allowed
  but clamped to ≤ now by the logger (current behaviour)?

## 12. Definition of done
All ACs pass; the Calendar tab shows the day's doses on a zone-correct axis,
blocks drag with 5-minute snapping and a live readout, taken doses re-time in
place (guardrails re-checked) and untaken doses route into the existing logger —
with the core geometry/snap logic pure and unit-tested, and `pnpm typecheck`,
`lint`, and `test` green.
