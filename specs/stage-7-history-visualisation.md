# Stage 7 Spec — History & Visualisation

| | |
|---|---|
| **Depends on** | Stage 2 (and the extension interface from Stage 1) |
| **Implements** | FR-HIS-1, FR-HIS-4, FR-HIS-5 |
| **Milestone** | C |
| **Status** | Ready after Stage 2 |

## 1. Objective
Provide rich **historical records**, **adherence visualisation**, and a **blood-level chart** that *renders* the output of the user's pharmacology extension (the app charts; it does not calculate). Add **export/import** for full data portability.

## 2. Scope
**In:** filterable history; adherence-over-time chart; blood-level chart fed by the extension; JSON + CSV export; JSON import.
**Out:** computing pharmacokinetics (extension only); cloud analytics (none — local rendering).

## 3. Prerequisites
Stage 2 persisted log; Stage 1 extension interface.

## 4. Functional requirements
- FR-7.1. History view: filter by medication and date range; show scheduled vs actual time+zone, dose, and adjusted/late/over-cap markers.
- FR-7.2. Adherence chart over a configurable window (timing-sensitive meds), readable on mobile.
- FR-7.3. **Blood-level chart:** if the extension exposes a level/series function, render predicted level over time with dose markers and the target band; if not provided, show an explanatory empty state (no fabricated curve).
- FR-7.4. Export **all** data as JSON (round-trippable) and as CSV (log-focused).
- FR-7.5. Import a previously exported JSON, with validation and a safe merge/replace choice.

## 5. Technical approach
- **Charts:** a lightweight library (e.g. Recharts) or hand-rolled SVG; keep bundle small; respect reduced-motion; mobile-first sizing.
- **Extension series hook (optional):** extend the pharmacology module with an optional `levelSeries(ctx): { t: Instant; level: number }[] | null`. The app only renders what it returns. Default returns `null` → empty state. **No pharmacology is computed in the app.**
- **Export:** serialise the canonical dataset (decrypted in memory) to JSON; flatten the dose log to CSV.
- **Import:** validate against the schema; offer "replace" or "merge by id/updatedAt" using the same merge rule as sync.
- **Privacy:** export is a deliberate user action; warn that exported files are unencrypted.

## 6. Tasks
1. Build the filterable history view (med + date filters).
2. Build the adherence-over-time chart (timing-sensitive meds).
3. Add the optional `levelSeries` hook and render the blood-level chart, with empty state when absent.
4. Implement JSON export (round-trippable) and CSV export (log).
5. Implement JSON import with validation + replace/merge.
6. Add the unencrypted-export warning.

## 7. Acceptance criteria
- AC1. Given a date range and medication filter, when applied, history shows only matching entries with correct markers.
- AC2. Given a window, when the adherence chart renders, it reflects taken/missed for timing-sensitive meds and is legible on a phone.
- AC3. Given the extension provides `levelSeries`, when the chart renders, it shows that series with dose markers and target band.
- AC4. Given no `levelSeries`, when the chart area renders, it shows an explanatory empty state and **no invented curve**.
- AC5. Given JSON export then import into an empty app, when compared, the dataset matches (round-trip).
- AC6. Given CSV export, when opened in a spreadsheet, the dose log is well-formed.
- AC7. Given an export action, when triggered, the user is warned the file is unencrypted.

## 8. Test plan
- Unit: filtering; CSV/JSON serialisation; import validation + merge.
- Round-trip: export → import equality.
- Chart rendering smoke incl. empty state when `levelSeries` is null.

## 9. Risks / decisions
- **Safety:** the app must never synthesise a blood-level curve itself; rendering is strictly downstream of the user's extension. Empty state when absent.
- Keep chart deps light to protect load performance (NFR-Performance).

## 10. Definition of done
All ACs pass; history filterable; adherence and (extension-fed) level charts render correctly incl. empty state; export/import round-trips; unencrypted-export warning present.
