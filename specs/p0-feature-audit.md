# P0 Feature Audit — research backlog → build status → new stages

_Source: `research/03-feature-list-prioritised-by-category.md`. This audit takes
every **P0 (Must)** item from the prioritised feature list, records its current
build status against the shipped app, and points each not-yet-built P0 at a new
spec stage. Completed P0s are kept here (per the backlog task) with a reference to
where they were delivered._

_Authored 2026-07-25 while starting handoff item 2 ("P0 feature stages"). The build
currently sits at Stage 21 (React-Aria dashboards + calendar); the new P0 stages
are numbered from 22 up and run on the same Implement→Validate→Review pipeline._

## Status legend

- ✅ **Done** — shipped and referenced below; to be re-verified by subagents.
- 🟡 **Partial** — the mechanism exists but the P0 as written is not fully met.
- ❌ **Not built** — no implementation (a spec may or may not exist).

## The 12 P0s

| # | Category | P0 feature | Status | Where / gap |
|---|----------|-----------|--------|-------------|
| 1 | Core med mgmt | Fixed daily schedule of grouped dose slots | ✅ Done | Stage 1 (FR-SCH-1…4); grouped slots are the spine |
| 2 | Core med mgmt | Log a dose taken / skipped / late (one tap) | ✅ Done | Stage 1/2 logging (FR-LOG); **skipped** status + lateness-aware adherence added in Stage 18.3/18.4 |
| 3 | Core med mgmt | Per-med metadata (name, **strength, form**, timing-sensitive flag) | 🟡 Partial | Stage 1 has name, unit, half-life, notes, active, and the `adjustWhenLate` timing-sensitive flag (FR-MED-2). **No `strength` and no `form` field.** → **Stage 22** |
| 4 | Core med mgmt | Run user-supplied dose-adjustment logic for late/missed ⚠️ | ✅ Done | Stage 1 pharmacology extension interface (FR-OSS-5; `core/pharmacology.ts`), no-op default |
| 5 | Logging & capture | Side-effect logging tied to a medication/occurrence | ❌ Not built | Stage 15 events exist but are **standalone flare-ups** — an `EventInstance` has no `medId`/occurrence link. → **Stage 24** |
| 6 | Physician outputs | One-page pre-visit summary (what changed + what to ask) | ❌ Not built | Stage 17 spec exists (**Draft, never implemented** — no summary UI in `src/ui`). → **Stage 23** |
| 7 | Physician outputs | Portable, current medication list (PDF/share) | ❌ Not built | No med-list export anywhere in the app. Depends on the Stage 22 metadata. → **Stage 23** |
| 8 | Engagement | Reliable, persistent/escalating reminders | 🟡 Partial | Stage 6 does SW notification scheduling + zone-aware timing; server-side Web Push/VAPID exists. **Delivery not wired to the built frontend (needs `VITE_VAPID_PUBLIC_KEY`); no escalation/persistence.** → **Stage 25** |
| 9 | Privacy | Local-first storage; user owns the data | ✅ Done | Stage 2 (IndexedDB, local store is source of truth; FR-SYNC-1) |
| 10 | Privacy | End-to-end encryption (at rest + in transit) | ✅ Done (with caveat) | TLS in transit + Supabase at-rest encryption satisfy this (FR-SEC-1). **Zero-knowledge E2E stays a deliberate non-goal** — the server must read records to validate them. _Decided 2026-07-25; restated in Stage 26._ |
| 11 | Privacy | No third-party data monetisation; transparent policy | 🟡 Partial | The practice holds (local-first, BYO-Supabase, no telemetry — NFR-Privacy). **No published, user-visible privacy/no-monetisation policy.** → **Stage 26** |
| 12 | Platform | iOS native (decided) | ❌ Not built — **DEFERRED** | PWA only; no Capacitor/native shell. Large, separate track. _Deferred out of this pass 2026-07-25; no spec authored. Revisit as its own initiative._ |

## New stages proposed for the not-built / partial P0s

| Stage | Covers P0s | Spec (authored 2026-07-25) | Status |
|-------|-----------|---------------|--------|
| **22** | #3 | `stage-22-medication-identity-metadata.md` | ✅ DONE (`62eac7e`) |
| **23** | #6, #7 | `stage-23-clinician-outputs.md` (implements the never-built Stage 17 draft) | ✅ DONE (`e115f81`) |
| **24** | #5 | `stage-24-side-effect-logging.md` | next |
| **25** | #8 | `stage-25-reminder-reliability.md` | |
| **26** | #11 (+ #10 posture) | `stage-26-trust-transparency.md` | |

_#12 (iOS native) is deferred out of this pass. #10 (E2E) needs no build work — its
posture is restated in Stage 26._

Grouping rationale: #6 and #7 are the two "physician outputs" P0s and share the
report/share plumbing, so they belong together (Stage 23), and both consume the
med metadata from Stage 22 — hence 22 sequences first as a small prerequisite.
#5, #8, #11 are independent and get their own focused stages.

## Verification of the ✅ Done P0s (2026-07-25)

Two read-only subagents traced each completed P0 core → store → UI and ran the
relevant suites. **No bugs found.** Verdicts: #1 VALID, #2 VALID-with-concerns,
#4 VALID, #9 VALID, #10 VALID. Non-blocking notes captured for later:

- **#2** — `late` is an adherence classification, **not** a first-class
  `OccurrenceStatus` (statuses are `upcoming|taken|due|missed|skipped`); a late dose
  shows as "taken" on Today with an offset label. By design (Stage 18.4), but does
  not literally match the P0 wording "a dose has status … late". Confirm the
  surfacing is intended. Also: "Take group" is offered on not-yet-due (`upcoming`)
  slots — harmless (logs early) but permissive.
- **#9** — `loadAll`'s first-run emptiness check omits `doseOverrides` and
  `scheduleSnapshots` (unreachable in practice; both are always derived from parent
  meds/slots — benign). JSON round-trip test fixture leaves those two groups empty,
  so they aren't exercised with data (coverage gap, not a defect).

None of these block the new stages; fold them into a later polish pass if desired.

## Open questions — resolved 2026-07-25

1. **E2E encryption (#10).** ✅ **Resolved:** treat #10 as met by TLS + at-rest
   encryption; **zero-knowledge stays a deliberate PRD non-goal** (the server must
   read records to validate them). No new build work; posture restated in Stage 26.
2. **iOS native (#12).** ✅ **Resolved:** **deferred** out of this pass. No spec
   authored; revisit as its own initiative.

## Next steps (backlog item 2)

1. ✅ Settle the two open questions above (done 2026-07-25).
2. ✅ Author Stages 22–26 (done 2026-07-25). iOS deferred; #10 needs no build.
3. 🔄 Spawn subagents to **verify the ✅ Done P0s** (#1, #2, #4, #9, #10) — in
   progress; fold any bugs found into the relevant stage or a fix commit.
4. Implement→Validate→Review cycle: **Stage 22 ✅**, **Stage 23 ✅** (with the
   optional Stage 16 regimen-change markers included), then **24 → 25 → 26**.
   Sequence note: 22 fed 23 (the med list renders strength/form); 24 feeds 23's
   summary (attributed side effects); 24/25/26 are otherwise independent.
