# Stage 17 Spec — GP Adherence Summary (clinician report & share)

> **Superseded by Stage 23.** This stage was never built standalone; its
> requirements (adherence + flare-up summary, print/share) are implemented by
> `specs/stage-23-clinician-outputs.md` (`core/clinicalReport.ts`,
> `buildPreVisitSummary`), which also folds in the Stage 16 regimen-change list.

| | |
|---|---|
| **Depends on** | Stage 1 (core), Stage 2 (persistence), Stage 7 (adherence + charts), Stage 15 (events = flare-ups); **optional** Stage 16 (regimen-change markers) |
| **Implements** | FR-17.1 … FR-17.7 |
| **Milestone** | C (daily-driver polish) |
| **Status** | Superseded by Stage 23 |

## 1. Objective
Produce a concise, clinician-ready **summary of medication adherence and flare-ups**
over a chosen period, to help a patient describe their condition and its management
to their GP. The summary combines adherence statistics, the adherence trend chart,
and a flare-up (event) summary into one readable report the user can **review,
print/save as PDF, and share** — generated **on-device** to preserve the
local-first, privacy-respecting stance. Server-side emailing is an explicit,
opt-in extra, not the default.

> Worked example: before an appointment the user picks "Last 90 days", reviews a
> report showing 92% adherence on timing-sensitive meds, a per-medication
> breakdown, an adherence trend chart, and "7 seizures (avg severity 3/5), most
> clustered in the week of 2 June", then taps **Share** to send the PDF to
> themselves or **Print** to bring a paper copy.

## 2. Scope
**In:** a pure-core **report model** builder that aggregates adherence (overall +
per medication), flare-up/event stats (counts, severity/duration summaries,
clustering by week), and — when Stage 16 is present — a list of regimen changes in
the period; a **GP Summary** screen rendering a clean, print-optimised report with
the existing adherence chart and a small flare-up chart; **export/share** paths:
browser **Print → Save as PDF** (offline, zero-dependency), the device **share
sheet** (`navigator.share`) where available, and a `mailto:` draft with the text
summary; a **disclaimer** restating the app records but does not advise. **Optional
(behind config, off by default):** a server-side `email-summary` Edge Function that
emails the report to an address the user enters, for users who opt in.
**Out:** clinician accounts/portals; automated scheduled sending; statistical
inference or diagnosis; FHIR/EHR export formats; rich PDF theming beyond the
print stylesheet. The app summarises recorded data only; it gives no medical advice.

## 3. Prerequisites
- Stage 7 adherence (`core/adherence.ts` `computeAdherence`, `core/history.ts`
  `adherenceTimeline`) and the chart components (`AdherenceChart`).
- Stage 15 events (`EventType` / `EventInstance` + `core/events.ts` summarisers)
  as the flare-up source.
- The assume-taken-on-time policy (Stage "assumeTakenOnTime" option): the report
  must state which adherence basis it used (assumed vs explicit) so a clinician can
  interpret the number correctly.
- For the optional email path: the existing Supabase Edge Function pattern
  (`supabase/functions/send-push`) and a transactional-email provider secret.

## 4. Data model
No new **syncable** entity. One pure, in-memory **report model** assembled on
demand:

```ts
interface ReportRange { from: ISODate; to: ISODate; days: number; }

interface MedAdherenceRow {
  medId: string; name: string; color: string;
  timingSensitive: boolean;
  expected: number; taken: number; missed: number; ratio: number;
}

interface FlareSummary {
  typeId: string; name: string; color: string;
  count: number;
  // present when the type has a scale/duration property:
  avgSeverity?: number; maxSeverity?: number; avgDurationSec?: number;
  byWeek: { weekStart: ISODate; count: number }[]; // clustering for the chart
}

interface ClinicalSummary {
  generatedAt: Instant; zone: IanaZone;
  range: ReportRange;
  basis: 'assumed-on-time' | 'explicit'; // how adherence was counted
  overall: { expected: number; taken: number; missed: number; ratio: number };
  perMed: MedAdherenceRow[];
  timeline: AdherenceDay[];            // reuse Stage 7's daily series for the chart
  flares: FlareSummary[];
  regimenChanges?: RegimenChange[];    // when Stage 16 is present, in-period
  notes?: string;                      // optional free-text the user adds
}
```

- Everything is **derived** from the existing dataset; nothing is persisted or
  synced. The report is reproducible from the data + range.
- `basis` is recorded so the percentage is never read out of context.

## 5. Functional requirements
- FR-17.1. **Pick a period.** The user selects a range (presets: 30 / 90 / 180
  days and a custom from–to), resolved in the active zone. Default 90 days.
- FR-17.2. **Adherence summary.** The report shows overall adherence (taken /
  expected, ratio %) and a **per-medication** breakdown, clearly limited to
  timing-sensitive meds for the headline figure (matching `computeAdherence`), and
  states the **basis** (assumed-on-time vs explicit).
- FR-17.3. **Adherence trend.** The report embeds the daily adherence chart for the
  period (reusing `AdherenceChart`/`adherenceTimeline`).
- FR-17.4. **Flare-up summary.** For each event type (Stage 15), the report shows
  the count in the period, severity/duration summaries where those properties
  exist, and a simple **per-week** cluster chart, so a GP can see frequency and
  trend at a glance.
- FR-17.5. **Regimen context (optional).** When Stage 16 is present, the report
  lists prescription/schedule changes in the period (date + summary) so adherence
  and flare-ups can be read against what changed.
- FR-17.6. **Review, print & share.** The user reviews the rendered report, can add
  a short free-text note, then: **Print / Save as PDF** via a print-optimised
  stylesheet (works offline, no dependency); **Share** via `navigator.share` where
  available; or open a **`mailto:`** draft pre-filled with the text summary. Every
  output carries the safety disclaimer and the generation date + basis.
- FR-17.7. **Optional server email (opt-in).** If the user enables it and provides a
  recipient, an `email-summary` Edge Function sends the report (HTML + text) via a
  configured email provider. It is **off by default**, gated behind explicit
  consent with a privacy warning (medical data leaves the device), authenticated
  (GoTrue session → RLS-scoped), and never enabled automatically.

## 6. Technical approach
- **Core (pure):** `core/clinicalSummary.ts` —
  - `buildClinicalSummary(dataset, range, now, { assumeTakenOnTime })` →
    `ClinicalSummary`, composing `computeAdherence` (overall + per-med via a
    per-medication pass), `adherenceTimeline`, and event aggregation from
    `core/events.ts` (counts, `summarizeInstance` values, week bucketing).
  - `formatSummaryText(summary)` → a plain-text rendering for `mailto:`/email body
    and clipboard; unit-tested, deterministic.
- **UI:** `ui/screens/GpSummaryScreen.tsx` (or a panel under History) —
  - Range picker; renders the report sections, the adherence chart, and a small
    `FlareChart` (per-week bars) presentationally from the core model.
  - A dedicated **print stylesheet** (`@media print`) hides app chrome/nav and lays
    the report out for A4/Letter; "Print / Save as PDF" calls `window.print()`.
  - "Share" uses `navigator.share` (feature-detected) with the text summary;
    "Email draft" builds a `mailto:` URL. A clear note explains a PDF must be
    attached manually on the `mailto:` path (mail clients can't be auto-attached
    from the browser).
  - The safety disclaimer (`ui/components/Disclaimer.tsx` copy) is reproduced in the
    report header/footer.
- **Optional Edge Function:** `supabase/functions/email-summary` — accepts the
  report HTML/text for the authenticated user and relays via a transactional email
  provider (provider key as a function secret). Mirrors `send-push` conventions
  (JWT verification, RLS-scoped, structured errors). Disabled unless the user opts
  in and a recipient is set; documented as a privacy trade-off.
- **No new sync surface.** Because the summary is derived, there is no records
  table / validator / pgTAP change. (If the user later wants saved reports, that is
  a separate stage.)

## 7. Tasks
1. `core/clinicalSummary.ts` (+ test): `buildClinicalSummary`,
   `formatSummaryText`, per-week event bucketing.
2. Per-medication adherence: a small helper (or `computeAdherence` parameterised by
   a single med) to fill `perMed`, reusing the timing-sensitive rule.
3. `ui/components/FlareChart.tsx`: per-week flare bars (presentational).
4. `ui/screens/GpSummaryScreen.tsx`: range picker, report layout, embeds
   `AdherenceChart` + `FlareChart`, note field, Print/Share/Email-draft actions.
5. Print stylesheet (`@media print`) + a nav entry / History panel link.
6. (Optional) `supabase/functions/email-summary` + config flag + consent UI +
   privacy warning; docs.
7. Docs: how to read the report; the assumed-vs-explicit basis; the privacy note
   for the optional email path.

## 8. Acceptance criteria
- AC1. Selecting "Last 90 days" produces a report with overall adherence (taken /
  expected, %), a per-medication breakdown, and an explicit statement of the
  **basis** (assumed-on-time vs explicit).
- AC2. The report embeds the adherence trend chart for the selected period and a
  per-week flare-up chart derived from logged events.
- AC3. Flare-up summary shows, per event type, the count and (where the type
  defines them) average/max severity and average duration over the period.
- AC4. "Print / Save as PDF" renders a clean, app-chrome-free A4/Letter report via
  the print stylesheet, including the disclaimer and the generation date + basis.
- AC5. "Share" uses the device share sheet where available; "Email draft" opens a
  `mailto:` pre-filled with the text summary; neither sends medical data to any
  server.
- AC6. The summary is pure and deterministic for a fixed dataset + range + clock
  (unit-tested), and counts adherence consistently with `computeAdherence`.
- AC7. (If implemented) the optional server email path is off by default, requires
  explicit consent with a privacy warning and a recipient, and is authenticated.

## 9. Test plan
- Unit: `buildClinicalSummary` (overall + per-med adherence matches
  `computeAdherence`; basis flag; event counts/severity/duration; week bucketing
  across zone/period boundaries; empty-data and single-day ranges);
  `formatSummaryText` snapshot.
- Component: report renders all sections; range changes recompute; print stylesheet
  hides nav (jsdom assertion on print container); Share/Email actions are
  feature-detected and disabled gracefully when unsupported.
- (Optional) Edge Function: rejects unauthenticated requests; returns structured
  errors; relays on success (mocked provider).
- (E2E, optional) generate a 90-day report and assert the rendered figures match
  the seeded dataset.

## 10. Risks / decisions
- **Privacy first.** Medication and event data are sensitive; the **default** paths
  (print/PDF, share sheet, mailto draft) keep data on-device. Server email is
  opt-in with an explicit warning — consistent with the export panel's "unencrypted
  plain text — share carefully" stance.
- **No medical advice.** The report only summarises recorded data; the disclaimer is
  reproduced on every output. It never interprets or recommends.
- **Adherence basis transparency.** Because assume-taken-on-time can make adherence
  read ~100%, the report always states the basis so a clinician isn't misled; a
  user preparing for a GP visit may prefer the explicit basis and can switch.
- **`mailto:` attachment limit.** Browsers can't attach a generated PDF to a
  `mailto:` draft; the UI states this and steers users to Print→PDF + Share, or the
  optional server email, for an attached document.
- **Dependency-light PDF.** Using the browser's print-to-PDF avoids a heavyweight
  PDF library and works offline; richer layouts can adopt a library later if needed.
- **Derived, not stored.** The report is recomputed on demand; no new syncable
  record, validator, or migration — smallest possible surface.

## 11. Definition of done
All ACs pass; a user can pick a period and generate a clear, on-device,
clinician-ready summary of adherence (with an explicit basis) and flare-ups —
including the adherence trend and per-week flare charts and, when available,
regimen-change context — then print/save it as a PDF or share it, with medical data
staying on-device by default and the safety disclaimer on every output.
