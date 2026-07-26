# Stage 23 Spec — Clinician Outputs (pre-visit summary + portable medication list)

| | |
|---|---|
| **Depends on** | Stage 1 (core), Stage 2 (persistence), Stage 7 (adherence + charts), Stage 15 (events = flare-ups), Stage 22 (med metadata); **optional** Stage 16 (regimen-change markers) |
| **Implements** | FR-23.1 … FR-23.9 · closes **P0 #6 + #7** (`specs/p0-feature-audit.md`) · **implements the never-built Stage 17 draft** |
| **Milestone** | Post-release P0 hardening |
| **Status** | Done |

## 1. Objective
Deliver the two P0 "physician & care-team" outputs — the headline differentiator
of the product. Both are generated **on-device** to preserve the local-first,
privacy-respecting stance, and both share one print/share pipeline.

1. **One-page pre-visit summary** (P0 #6) — a concise, clinician-ready report of
   **what changed and what to ask about**: adherence stats + trend, flare-up
   summary, and (when Stage 16 is present) regimen changes over a chosen period.
   This **implements `specs/stage-17-gp-adherence-summary.md`**, which was specced
   as a Draft but never built; Stage 17 remains the detailed source of truth for
   the report's contents (FR-17.1 … FR-17.7). Stage 23 supersedes it as the build
   stage and folds in the medication list below.
2. **Portable, current medication list** (P0 #7) — a share/printable list of the
   patient's **current active medications** with strength, form, schedule, and
   guardrails: the artifact useful at every visit and in ER/hospital contexts.

> Worked example: before an appointment the user opens **Clinician outputs**, taps
> **Medication list** to share a one-page "current meds" PDF to their phone, then
> picks **Pre-visit summary → Last 90 days**, reviews 92% adherence on
> timing-sensitive meds, "7 seizures (avg severity 3/5) clustered in early June",
> and a "started Lamotrigine 2026-05-02" regimen note, and taps **Share**.

## 2. Scope
**In:**
- The **pre-visit summary** per Stage 17 §5 (report model builder in pure core;
  GP Summary screen; print stylesheet). Reuse the existing adherence engine
  (`core/adherence.ts`), event stats (`core/events.ts`), and Stage 16 regimen
  changes (`core/regimenChanges.ts`).
- A **"what to ask" surface**: a short, deterministic, **non-prescriptive**
  highlights block derived from the recorded data (e.g. "3 missed timing-sensitive
  doses in the last 14 days"; "new medication started this period") — descriptive
  only, never advice.
- The **portable medication list**: a pure-core `buildMedicationList()` producing
  an ordered list of active meds with `medicationLabel()` (Stage 22), each med's
  scheduled times + doses, unit, guardrails (caps/min-interval), and notes; plus a
  print-optimised **Medication List** view.
- **Export/share** paths shared by both outputs: browser **Print → Save as PDF**
  (offline, zero-dependency), the device **share sheet** (`navigator.share`) where
  available, and a `mailto:` draft carrying the text form. A **disclaimer** on both
  restating the app records but does not advise.

**Out:** clinician accounts/portals; scheduled/automated sending; the optional
server-side email Edge Function (that stays FR-17.7, deferred); statistical
inference/diagnosis; FHIR/EHR/CCDA export formats; the secure one-time share
**code/link** (that is P1 — a separate stage); rich PDF theming beyond the print
stylesheet.

## 3. Prerequisites
- Stage 22 `strength`/`form` + `medicationLabel()` (the med list renders them).
- `core/adherence.ts` (`computeAdherence`, `classifyOccurrences`), `core/events.ts`
  (event aggregation), `core/regimenChanges.ts` (optional regimen context).
- Stage 21 dashboards/charts on the design system (the summary embeds the adherence
  trend chart).

## 4. Functional requirements

### Pre-visit summary (P0 #6)
- **FR-23.1** — Implement the Stage 17 report model builder in pure core: overall +
  per-medication adherence, flare-up/event stats (counts, severity/duration
  summaries, weekly clustering), and — when Stage 16 is present — regimen changes
  in the period. Satisfies FR-17.1 … FR-17.5.
- **FR-23.2** — Render a **one-page**, print-optimised **Pre-visit summary** screen
  with a period picker (presets 30/90/180 days + custom), the adherence trend
  chart, and a small flare-up chart. Satisfies FR-17.6 (review/print/share).
- **FR-23.3** — A **"What changed / what to ask"** highlights block: a bounded,
  deterministic, **descriptive** list generated from the period's data (missed
  timing-sensitive counts, new/stopped meds, notable flare-up clusters). It
  **originates no clinical judgement or recommendation** — surface, don't interpret.
- **FR-23.4** — A visible **disclaimer**: the app records and summarises recorded
  data and gives no medical advice.

### Portable medication list (P0 #7)
- **FR-23.5** — A pure-core `buildMedicationList(dataset)` returning current
  **active** medications (excludes inactive/deleted), each with: label
  (name + strength + form), unit, all scheduled times + doses (from the current
  schedule), guardrails, and notes. Deterministic order (by first scheduled time,
  then name).
- **FR-23.6** — A print-optimised **Medication List** view rendering FR-23.5 with a
  generated-on date and the active timezone; legible in one page for a typical
  regimen.
- **FR-23.7** — The medication list is **current-state** (not period-scoped): it
  reflects the schedule/meds as they are now, independent of the summary's period.

### Shared output pipeline
- **FR-23.8** — Both outputs support **Print → Save as PDF** (offline), the
  **share sheet** (`navigator.share`) where available with a graceful fallback, and
  a **`mailto:`** draft carrying the text form. No output leaves the device except
  by an action the user explicitly takes.
- **FR-23.9** — A single **Clinician outputs** entry point in the app surfaces both
  the Pre-visit summary and the Medication list.

## 5. Acceptance criteria
- **AC1** — Picking "Last 90 days" renders adherence (overall + per-med) matching a
  hand-computed fixture, the trend chart, and a flare-up summary; changing the
  period re-computes. (Core builder mutation-proven.)
- **AC2** — The "what to ask" block is present, is derived only from recorded data,
  and contains no prescriptive/advice language (asserted by a copy test against a
  banned-phrase list).
- **AC3** — With Stage 16 present, a regimen change inside the period appears in the
  summary; with it absent, the section is omitted cleanly (no crash).
- **AC4** — The medication list shows every active med with strength + form +
  scheduled times/doses + caps; an inactive med is excluded; it renders on one page
  for a 5-med regimen.
- **AC5** — Print → Save as PDF works offline for both outputs; `navigator.share`
  is used when present and falls back to `mailto:`/download when not; nothing is
  transmitted without a user action.
- **AC6** — The disclaimer is present on both outputs.
- **AC7** — All new aggregation is pure core with unit tests; the UI is presentation
  only (no business logic), holding the `src/core` boundary.

## 6. Open questions
- Does the pre-visit summary include a compact **current medication list** inline,
  or only cross-link to the standalone list? Current call: cross-link + a one-line
  "N active medications" count in the summary, to keep the summary to one page.
- Should the "what to ask" highlights be user-editable before share (add a note)?
  Deferred; FR-17.6's free-text note covers the summary. Revisit after dogfooding.
