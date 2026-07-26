# Stage 11 Spec — Logging-Time UX (custom time, 5-minute steps)

| | |
|---|---|
| **Depends on** | Stage 1 (DoseLogger), Stage 2 (persisted log) |
| **Implements** | FR-11.1, FR-11.2, FR-11.3 |
| **Milestone** | C (daily-driver polish) |
| **Status** | Done |

## 1. Objective
Make recording **when** a dose was actually taken fast and frictionless. A dose is
frequently taken at a time other than the scheduled one (forgotten, taken early,
taken late), so the "time taken" control must be quick to adjust on a phone — not
a fiddly minute-by-minute picker.

## 2. Scope
**In:** the "Time taken" control inside `DoseLogger`; quick presets; coarser
(5-minute) granularity; a clear late/early indicator.
**Out:** changing what a logged dose *means*, guardrails, or the dose amount. The
next-dose adjustment is a separate concern (see `stage-12-next-dose-override.md`).

## 3. Prerequisites
The Stage 1 `DoseLogger` with its `datetime-local` "Time taken" input and the
`core/time.ts` zone-aware conversions (`instantToDatetimeLocal`,
`datetimeLocalToInstant`).

## 4. Functional requirements
- FR-11.1. **5-minute granularity.** The time control steps in 5-minute
  increments. The default ("now") is rounded to the nearest 5 minutes so the most
  common path needs zero adjustment.
- FR-11.2. **Quick presets.** One-tap buttons set the time without opening a
  picker: **Now**, **Scheduled** (the slot's scheduled instant), and relative
  nudges **−15m / −30m / −1h** counting back from the current value. Presets never
  produce a future instant beyond "now".
- FR-11.3. **At-a-glance feedback.** When the chosen time differs materially from
  the scheduled time, show a small relative hint (e.g. "2h 30m late", "10m early")
  so the user can confirm the entry at a glance.
- FR-11.4. **Zone correctness preserved.** All conversions continue to resolve in
  the app's active zone (never the host zone). No regression to FR-5.6 occurrence
  matching: a late dose still maps to its scheduled occurrence.

## 5. Technical approach
- **Core helpers (pure, `core/time.ts`):**
  - `roundInstantToStep(instant, stepMs)` — round to the nearest step (default
    5 min) for the "now" default and relative nudges.
  - `describeOffset(actual, scheduled)` — human string like `"2h 30m late"` /
    `"10m early"` / `"on time"`; pure and unit-tested (DST-agnostic, uses elapsed
    ms).
- **Input granularity:** set `step={300}` (seconds) on the existing
  `datetime-local` input so native spinners move in 5-minute jumps; seed its
  default from `roundInstantToStep(now)`.
- **Presets:** plain buttons that recompute the `whenStr` via
  `instantToDatetimeLocal(...)`. "Scheduled" uses `target.scheduledInstant`;
  relative nudges subtract from the current value then clamp to ≤ now.
- **Feedback:** render `describeOffset` beneath the control; reuse the existing
  amber "adjusted" styling vocabulary, not a new colour system.

## 6. Tasks
1. Add `roundInstantToStep` and `describeOffset` to `core/time.ts` with tests.
2. Default the logger's "time taken" to now rounded to 5 minutes; add `step={300}`.
3. Add the **Now / Scheduled / −15m / −30m / −1h** preset row, clamped to ≤ now.
4. Show the relative late/early hint from `describeOffset`.
5. Verify occurrence matching is unaffected (late dose still maps to its slot).

## 7. Acceptance criteria
- AC1. Opening the logger defaults "time taken" to the current time rounded to the
  nearest 5 minutes.
- AC2. The native time spinner advances/retreats in 5-minute steps.
- AC3. Tapping **Scheduled** sets the time to the slot's scheduled wall-time;
  tapping **−30m** moves the current value back 30 minutes; no preset yields a
  time after "now".
- AC4. Choosing a time later than scheduled shows an "N late" hint; earlier shows
  "N early"; within tolerance shows "on time".
- AC5. A dose logged late via the picker is still matched to its scheduled
  occurrence on Today (no duplicate "due" row).

## 8. Test plan
- Unit: `roundInstantToStep` (nearest, ties, exact); `describeOffset` (late, early,
  on-time, multi-hour, across a DST boundary).
- Component/E2E: logger defaults to a 5-min-rounded now; presets set expected
  values; late hint renders.

## 9. Risks / decisions
- `datetime-local` `step` support varies by browser for *typed* input; the spinner
  and our rounded default keep the 5-minute contract regardless. Manual typing of
  an off-step minute is tolerated (still resolved correctly).
- Keep the preset set small (4 buttons) to avoid clutter on small screens.

## 10. Definition of done
All ACs pass; the time control defaults to a rounded "now", steps by 5 minutes,
offers the preset row, and shows the late/early hint — with no regression to
zone-aware occurrence matching.
