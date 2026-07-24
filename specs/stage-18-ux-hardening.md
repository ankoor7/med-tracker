# Stage 18 Spec — UX Hardening (historical fidelity, correction paths & safe destructive actions)

| | |
|---|---|
| **Depends on** | Stage 1 (core scheduler + adherence), Stage 2 (persistence), Stage 7 (charts), Stage 13 (calendar drag), Stage 16 (regimen-change records) |
| **Implements** | FR-18.1 … FR-18.11 |
| **Milestone** | C (daily-driver polish) |
| **Status** | Draft |
| **Evidence** | Six scripted user journeys driven through the live UI, 2026-07-20 (see §9) |

## 1. Objective
Close the gap between what the data model already gets right and what the UI
actually shows. Six end-to-end user journeys were driven through the running app
against the local Supabase stack; **none produced a console error**, yet four of the
six failed or partially failed. Every defect found is **silent** — the app reports
success while displaying something untrue about the user's own history.

The underlying storage is sound: doses are never destroyed, medications
soft-tombstone, and Stage 16 change records are captured correctly. The failures
are in the **read paths** — the screens that project stored data back to the user,
and the correction paths that let a user fix a mistake. This stage makes the app's
displayed history faithful to what actually happened, gives the user a way to undo,
and stops destructive actions firing without warning.

> Worked example: a patient's neurologist raises their Lamotrigine from 150 mg to
> 200 mg on 20 July. Today, opening the calendar to *yesterday* shows 200 mg — a
> dose they never took. Their adherence chart counts doses logged 15 hours late as
> 100 % adherent. If they then retire Levetiracetam, last week's adherence silently
> drops from 28 expected doses to 14, as though it had never been prescribed. Each
> of these is a report they might hand to a clinician.

## 2. Scope
**In:** effective-dated resolution of the schedule so past days render from the
regimen *as it was on that day*; lateness-aware adherence; a `skipped` dose status
(already declared in the type system, never written); UI correction paths for
logged doses (edit time, delete/undo); confirmation on destructive actions; honest
disclosure of assumed-vs-logged doses; an add-medication → schedule handoff;
input validation on the medication form (name uniqueness, non-negative numerics,
daily-total guardrails); guardrail and state feedback on the calendar surface;
copy fixes and removal of a raw-ID leak.

**Also in:** removal of the blood-level chart as a user-facing concept (§8) — a
predicted concentration curve is not for the user to track or visualise, and the
History screen currently advertises it as a merely-unconfigured feature.

**Out:** any new charting capability; clinical interpretation of lateness;
back-dating or hand-authoring regimen changes
(Stage 16 explicitly excludes this and that stands); redesign of the tab structure.

## 3. Prerequisites
- `core/schedule.ts` occurrence enumeration and `core/adherence.ts`.
- Stage 16 `RegimenChange` records — these already carry `changedAt`, the active
  zone, and field-level `from`/`to` diffs, and are the raw material for §4.
- `store/store.ts` mutating actions, including the already-implemented but
  **unreferenced** `deleteLogEntry`.
- `ui/screens/` (Today, Calendar, Schedule, Meds, History) and
  `ui/components/GroupLogger.tsx` / `DoseLogger.tsx`.

## 4. The central defect — the schedule has no effective-dating

Every screen projects **every** day, past and future, by reapplying the *current*
schedule configuration. There is no notion of "the regimen as of date X". This one
root cause produced failures in four of the six journeys:

| Edit made today | What the user sees on *yesterday* | Verified in |
|---|---|---|
| Lamotrigine 150 mg → 200 mg | Yesterday shows 200 mg | Journey 2 |
| Evening slot 20:00 → 21:00 | Yesterday's evening slot moved to 21:00 | Journey 2 |
| New Midday slot added | Midday slot appears on yesterday | Journey 2 |
| Levetiracetam deactivated | Vanishes from past calendar days; adherence drops 28 → 14 expected across *all* prior days | Journey 6 |

This defeats the stated purpose of Stage 16. That stage exists so "trends can be
read in context" — but the marker layer renders correctly while the chart beneath
it has already been retroactively rewritten to the new regimen. The app tells the
user something changed while simultaneously showing them it never did.

Two viable implementations; **(a) is recommended** because the data already exists:

**(a) Reconstruct from change records.** Resolve the schedule for date *D* by
taking the current configuration and reversing every `RegimenChange` with
`changedAt > D`. The Stage 16 diffs (`field`, `from`, `to`) are sufficient. No new
entity, no migration; correctness depends on change records being complete, which
Stage 16 already requires.

**(b) Effective-dated schedule versions.** Store schedule snapshots with validity
intervals and select the applicable one per day. More robust and simpler to reason
about at read time, but adds an entity, a migration, and sync surface.

Either way the resolution must be a **pure core function** — the boundary rule in
CLAUDE.md applies — with the UI and adherence calculator as callers:

```
resolveScheduleAsOf(dataset: Dataset, date: LocalDate, zone: Zone): ResolvedSchedule
```

Medications additionally need a **start date** (or first-prescribed instant): with
none, widening the adherence window to 14 days fabricated 100 % adherence back to
dates before the regimen existed (Journey 3).

## 5. Functional requirements

**FR-18.1 — Historical fidelity.** Past days MUST render from the regimen in
effect on that day. A regimen edit MUST NOT alter any previously displayed dose
amount, slot time, slot membership, or adherence figure for a date before the
change. Retiring a medication MUST NOT remove it from past days' expected doses.

**FR-18.2 — Dose correction.** A logged dose MUST be editable (time and amount)
and deletable from the screen where the user notices the error — Today and History
at minimum. `deleteLogEntry` (`store/store.ts:549`) already exists and MUST be
wired to the UI. Deletion MUST be confirmed or undoable.

**FR-18.3 — Skipped doses.** `DoseStatus` already declares
`'taken' | 'skipped'` (`core/types.ts:45`) but `logDose` hardcodes `'taken'`
(`store/store.ts:491`). A user MUST be able to record a deliberately withheld dose
distinctly from a forgotten one, and adherence MUST report the two separately.

**FR-18.4 — Lateness-aware adherence.** `core/adherence.ts:56` counts any dose
with `status === 'taken'` as adherent regardless of delay; doses logged 15 h 30 m
and 3 h 30 m late left a 100 % / 0-missed figure unchanged. Adherence for
**timing-sensitive** medications MUST reflect timing, with an explicit,
documented, configurable on-time window. The app MUST NOT interpret this
clinically — it reports the number, it does not judge it.

**FR-18.5 — Destructive actions.** Deleting a medication currently fires directly
from `onClick` (`ui/screens/MedsScreen.tsx:64`) with no dialog, no undo, no toast.
Every destructive action MUST require confirmation naming what will be affected,
and SHOULD state that dose history is retained. "Stop taking" (soft, `active:
false`) MUST be visually distinct from and offered *before* "Delete" — the soft
path is currently an `Active` checkbox buried below guardrails and notes inside
the Edit form, so a user wanting to stop a medication plausibly reaches for Delete.

**FR-18.6 — Assumed vs logged.** With `assumeTakenOnTime` on (the default), a
fresh install displayed **"5 of 5 doses taken"** against an empty dose log.
Assumed doses MUST be visually distinct from genuinely logged ones on Today,
Calendar and History, and any adherence figure derived partly from assumption MUST
say so. Whether this setting should remain on by default is an open question
(§7).

**FR-18.7 — Add-medication handoff.** Saving a new medication returns to a flat
list with no prompt. Because dose amounts live at the slot level, an unscheduled
medication never appears on Today, Calendar, or the dose log — the user is
silently left with a medication that does nothing. The add flow MUST offer
scheduling on completion.

**FR-18.8 — Input validation.** `MedEditor.save()` (`ui/screens/MedsScreen.tsx:108`)
validates only that the name is non-empty. The form MUST reject duplicate
medication names (a second, indistinguishable "Lamotrigine" saved silently — a
real dose-confusion risk) and negative or zero numerics (`-5` persisted and
displayed as "Caps: single -5mg"; the `min="0"` attributes at lines 164/175/186 are
cosmetic only). The slot editor MUST validate the **daily total across all slots**
against `maxDailyDose` — three 200 mg Lamotrigine slots totalling 550 mg/day passed
silently against a stated 400 mg cap.

**FR-18.9 — Calendar feedback.** (a) Guardrail violations MUST be surfaced on the
calendar itself; a min-interval breach created *by a calendar drag* was recorded
correctly but was only discoverable by navigating to History → Dose log — the one
screen where the conflict is created is the one screen that hides it. (b) Dragging
a **future** dose currently discards the dragged time and silently substitutes
"now" (`ui/components/GroupLogger.tsx:63`); this MUST either be prevented with an
explanation or honoured, never silently overridden. (c) Missed, upcoming, and
assumed-taken doses MUST be distinguishable at a glance — they currently share an
identical dashed block, differing only by a 10 px "· missed" label.

**FR-18.10 — Copy and leaks.** `ui/screens/ScheduleScreen.tsx:76` filters
medications to `active` before the id → name lookup at line 133, so a slot holding
a deactivated medication falls through to `item.medId` (line 137) and renders the
raw string `seed-med-levetiracetam` with a blank unit. Fix the lookup. Additionally:
the guardrail acknowledgement button reads "Log over-cap dose" even for a
min-interval breach, and "Half-life", "Guardrails" and "Min interval" carry no
inline explanation — "Timing-sensitive (needs an adjusted dose when late)" already
does this well and is the pattern to follow.

## 6. Acceptance criteria

Automated where feasible; AC1–AC4 are core-level and MUST be unit tests.

- **AC1** Given a logged history, when a medication's slot dose is changed, then
  `resolveScheduleAsOf` for any prior date returns the original amount, and the
  adherence figure for prior dates is byte-identical to before the edit.
- **AC2** Given a medication is deactivated, when adherence is computed for a
  window covering dates when it was active, then its expected doses for those
  dates are unchanged.
- **AC3** Given an adherence window wider than a medication's start date, then
  days before that date are excluded from its expected-dose count.
- **AC4** Given a timing-sensitive medication and a dose logged outside the on-time
  window, then adherence reflects the lateness and reports it distinctly from both
  on-time and missed.
- **AC5** A logged dose can be edited and deleted from Today and from History; the
  delete is confirmed or undoable.
- **AC6** A dose can be marked skipped, and skipped/missed/taken are reported as
  three distinct outcomes.
- **AC7** Deleting a medication requires explicit confirmation; its dose-log
  entries remain present and correctly named afterwards (this already holds at the
  storage layer and MUST NOT regress).
- **AC8** Saving a duplicate medication name, a negative guardrail, or a slot set
  exceeding `maxDailyDose` is rejected with a specific, actionable message.
- **AC9** Dragging a future dose on the calendar either is prevented with a visible
  explanation, or logs at the dragged time — never silently at "now".
- **AC10** No screen renders a raw entity id.
- **AC11 (E2E)** The Stage 10 Playwright suite gains a regression scenario:
  seed history → change a dose → assert prior days' rendered amounts and adherence
  are unchanged.

## 7. Open questions
1. **`assumeTakenOnTime` default.** Should it remain on? It makes a fresh install
   look complete and a real audit impossible without finding a setting in History →
   Settings; toggling it off swings the whole history to "missed" with no
   explanation that this is an artefact of the toggle. **Settled:** keep it **on**
   by default, and render assumed doses distinctly per FR-18.6. The honesty
   problem is a display problem, not a default problem — a fresh install should
   still look complete rather than greeting a new user with a wall of "missed".
2. ~~**On-time window for FR-18.4.**~~ **Settled:** a single **global** window the
   user sets, applied to all medications. No per-medication override. A window
   that is too tight will read as punitive to a patient, so the default should be
   generous and the setting easy to find.
3. ~~**§4 implementation choice.**~~ **Settled:** effective-dated snapshots (b),
   plus repaired change-record diffs. Option (a) was audited and found unsound —
   `deleteMedication` recorded no slot cascade, slot-dose diffs were keyed by
   medication name, and `from`/`to` were display strings. See pieces 1 and 2.
4. ~~Should the Meds and Schedule tabs merge?~~ **Settled: yes, merge them.**
   Testers repeatedly could not predict which tab owned dose amounts (Schedule)
   versus guardrails (Meds). See **FR-18.12** below — this is a larger change than
   the rest of Stage 18 and needs its own design pass.

## 11. FR-18.12 — Merge the Meds and Schedule tabs

**Why.** "Where do I change my dose?" has no predictable answer today. A
medication's identity, guardrails and half-life live on **Meds**; its dose
amounts and times live on **Schedule**, inside a per-slot editor. Nothing signals
the split, and a medication card never mentions the slots it appears in. Every
journey that touched a regimen hit this (Journeys 2 and 5 both logged it).

**Requirement.** One tab owns a medication end to end: what it is, what it is
capped at, when it is taken, and how much at each time. A user changing a dose
should not have to know which of two screens models it.

**Sequencing.** FR-18.12 lands **before** FR-18.7, FR-18.8 and the
`ScheduleScreen` half of FR-18.10, because all three add UI to screens this
merges — building them first means building them twice:
- FR-18.7's "prompt to schedule after adding a medication" may dissolve entirely
  once adding a medication and scheduling it are one flow. If so, satisfy the
  requirement (a medication cannot be silently left unscheduled and invisible)
  rather than the literal prompt.
- FR-18.8's validation and FR-18.10's raw-id leak land in whatever the merged
  editor becomes.

**Constraints.** The merge is presentation-level: `Medication` and `Slot` stay
separate entities, the store actions keep their shapes, and the sync surface does
not change. Slot-level dose is deliberately per-time-of-day and must remain so —
do not flatten a medication to a single dose. Everything in §9's must-not-regress
list still applies, and the Stage 16 change records emitted by each edit must be
unchanged in kind and content.

**Acceptance.**
- **AC13** A user can add a medication, set its guardrails, and put it on a
  twice-daily schedule without leaving one tab, and it appears on Today.
- **AC14** Editing a dose amount, a slot time, and a guardrail each still emit the
  same `RegimenChange` records as before the merge.

## 8. The blood-level chart — settled: it must never render

A predicted blood-level curve is **not something the user should track or
visualise**, and this stage settles that as a product decision rather than an open
one. Modelled drug concentration invites a patient to read a number as if it were
a measurement and to self-adjust against it — precisely the behaviour the app's
central safety rule forbids ("the app never originates a dose value; it records and
validates").

The engine already behaves correctly: `core/pharmacology.ts:74` hardcodes
`activeStrategy = noopStrategy`, whose `levelSeries()` returns `null`. Nothing
about that changes. What is wrong is the **UI still advertising the chart**: the
History screen renders a "Predicted blood level — Lamotrigine" heading and the
message "No predicted curve. SteadyDose computes no pharmacology itself — provide a
pharmacology extension with a `levelSeries` function to chart predicted levels
here." To a patient this reads as a promised feature that is merely unconfigured,
and it framed the whole of Journey 3 as broken.

**FR-18.11 — Remove the blood-level chart as a user-facing concept.** The History
screen MUST NOT render a blood-level chart, heading, placeholder, or invitation to
supply a pharmacology extension. `BloodLevelChart.tsx` and its call site should be
removed from the UI. The `levelSeries` extension point MAY remain in the core as a
third-party integration seam, but it is developer-facing only and MUST NOT be
surfaced or documented in the app itself. Stage 7's "blood-level chart that renders
the extension's output" is **superseded** by this requirement, and
`specs/03-implementation-plan.md`'s Stage 7 summary should be annotated accordingly.

- **AC12** No blood-level chart, heading, or extension-related placeholder appears
  on any screen.

This also resolves two Journey 3 checks (retroactive redraw of the pre-change
curve; multi-medication chart readability) as **not applicable** rather than
untested — there is no such chart to verify.

## 9. Evidence — journey results

Six journeys, each from a clean `pnpm local:reset` + IndexedDB wipe + reseed,
driven through the real UI. **Zero console errors in any journey.**

| # | Journey | Result | Primary finding |
|---|---------|--------|-----------------|
| 1 | Logging medication times | PARTIAL | No undo; no skip status; "5 of 5 taken" with nothing logged |
| 2 | Changing a regimen | **FAIL** | Edits retroactively rewrite past days (§4) |
| 3 | Graphs across a change | **FAIL** | Adherence blind to lateness; fabricated history on wide windows |
| 4 | Using the calendar | PARTIAL | Silent future-drag clamp; guardrail breaches invisible on-surface |
| 5 | Adding a medication | PARTIAL | No schedule handoff; duplicate names and negative numerics accepted |
| 6 | Removing a medication | PARTIAL | Dose log survives correctly; adherence summary does not |

### Journey 2 — Changing a regimen
```gherkin
Given my neurologist raised my Lamotrigine dose
When I raise the dose 150mg → 200mg
Then past history keeps its original amounts
  ✗ yesterday immediately displayed 200mg
When I check the change was recorded
Then a dated marker appears
  ✓ marker, diff text, calendar chip, history entry — Stage 16 works
When I shift my evening dose 20:00 → 21:00
Then only future occurrences move
  ✗ yesterday moved too
When I set when the change takes effect
Then I can choose today / tomorrow / retroactive
  ✗ no effective-from control exists anywhere
```

### Journey 6 — Stopping a medication (the paramount requirement)
```gherkin
Given my neurologist discontinued Levetiracetam
  And I have logged doses I need for my next appointment
When I deactivate it and check my dose log
Then every logged dose is still there, correctly named
  ✓ PASS — 1000mg @08:00 and 900mg @20:00 (adjusted) intact across reload.
    Same for hard delete: the store soft-tombstones, so no dose record was
    lost or corrupted at any point in any of the six journeys.
But when I check my adherence chart and past calendar days
Then they should still show I was taking it last week
  ✗ adherence dropped 28 → 14 expected across all prior days
When I look for how to stop it
Then "stop taking" is clearly distinct from "delete permanently"
  ✗ the card offers only Edit / Delete; the soft path is a checkbox
    buried inside the Edit form
```

### What already works well and must not regress
- The guardrail warning pattern: names the exact numbers violated, gates submission
  behind an explicit acknowledgement checkbox, and never originates a dose amount.
- The log dialog's time presets (Now / Scheduled / −15 m / −30 m / −1 h) — the
  strongest flow in the app, and a clean satisfaction of the Stage 11 spec.
- Calendar drag mechanics: pointer capture, 5-minute snapping, commit-on-drop, and
  arrow-key nudging (Stage 13 AC1–AC3, AC6 all held).
- Stage 16 change capture: correct markers, readable diffs, same-day grouping, and
  an automatic "Retired X" / "Added X" audit trail.
- The soft-tombstone storage model itself (`store.ts:353-380`,
  `localRepository.ts:161-175`) — genuinely safe, just never communicated to the user.

## 10. Suggested sequencing
1. §4 effective-dating (FR-18.1) — largest change, resolves journeys 2, 3, 4 and 6.
2. FR-18.5 confirmation + FR-18.2 correction paths — small, removes the sharpest edges.
3. FR-18.4 lateness-aware adherence + FR-18.3 skipped status — the two clinically
   misleading outputs.
4. FR-18.6 through FR-18.10 — validation, handoff, calendar feedback, copy.
5. FR-18.11 — remove the blood-level chart UI. Independent of everything above and
   the cheapest item on the list; can land first if convenient.
