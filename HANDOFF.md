# Handoff — P0 track, Stage 24 (in progress)

_Updated 2026-08-01. Branch: `claude/p0-feature-stages-ekntci` (pushed, remote
level at `d860637`). Session stopped by the user mid-Stage-24. Read this section
first; the older Stage-18/22/23 history follows._

## Where Stage 24 actually is

| Unit | What                                                                     | Commit    | State                                       |
| ---- | ------------------------------------------------------------------------ | --------- | ------------------------------------------- |
| U1   | Core types + FR-24.4 validation + FR-24.5 `sideEffectsForMedication`     | `7acba36` | **Done** — implemented, validated, reviewed |
| U2   | `cloudRecord` mapping, migration `0011`, pgTAP, export/import round-trip | `3cc50fa` | **Done** — implemented, validated, reviewed |
| U3   | UI: type category, logger attribution, "Log side effect" from a dose row | `d860637` | **UNFINISHED — do not trust**               |
| U4   | Stage 23 pre-visit summary hook (FR-24.7 / AC7)                          | —         | **Not started**                             |

Tree is clean; typecheck clean; **668 tests / 52 files green** (baseline was 609).

### U3 is committed but not finished

`d860637` is a deliberate WIP commit made to preserve work before the container
was reclaimed. Its message lists the gaps; the important ones:

- The `EventLogger` extraction landed **after** the validator signed off the live
  flows, so **U3 has not been re-validated in the running app.** Re-check the
  "Log side effect" path from a dose row and the `FirstTypePrompt` first-run path
  before trusting it.
- The **fallow gate was mid-clear**: `ValueInput`, `TodayScreen`, and four
  test-file clone groups were still outstanding. The commit went through the
  pre-commit hook without being blocked, but that is not the same as the
  reviewer's findings having been cleared — they were not confirmed.
- **No reviewer pass on U3.** A `stamp()` precedence sweep across all callers was
  requested and never reported back (see below).
- When deduping those clone groups, do not weaken what AC1/AC2 prove — near-identical
  tests may pin different regressions.

### Findings from this session worth keeping

- **`validate_record` is re-declared in full by each migration.** The authoritative
  body was `0010`, not `0004`. `0011` re-declares it; it was diffed against `0010`
  and differs only in the two intended additions. Any future migration must do the
  same or it will silently revert validator logic.
- **SQL `NULL not in (...)` evaluates to `NULL`, which `if` treats as false.** A
  first draft of the `category` check copied the `regimenChange.kind` idiom and
  would have let JSON `category: null` pass the server while TS rejected it.
  Fixed with `jsonb_typeof(...) is distinct from 'string'`. Neither vitest nor
  (here) pgTAP would have caught it — only static review did.
- **`stamp()` spread order was inverted** to `{ ...input, id, zone, updatedAt }` so
  a caller cannot override the app's own stamping. This is a precedence change on a
  **shared helper**: any caller that passed an explicit `updatedAt` and silently won
  now silently loses. **The all-callers sweep was requested but never reported — do
  it before trusting U3.**
- **`sideEffectsForMedication` does not re-check that its `medId` still resolves** —
  that is call-site discipline. **U4 must drive its grouping from
  `dataset.medications.filter(live)`**, or a side effect attributed to a deleted
  medication can surface in the clinician-facing pre-visit summary.
- **Spec §7 Q1 is settled and struck in the spec:** `validate_record` is `immutable`
  and sees one record at a time with no cross-record lookup, so hard-rejecting a
  dangling `medId` is not implementable in the single-table design. Server accepts
  optional strings; the client resolver is authoritative.

### Environment gotchas specific to the cloud container

- **No Docker.** `pnpm local:up/reset/env`, `pnpm db:test` (pgTAP), and `pnpm test:e2e`
  cannot run. The app runs local-first (no `VITE_SUPABASE_*`), which is fine for UI
  validation. **The `0011` pgTAP suite is written but has never been executed** —
  CI's `db-tests` job is its first real run. AC6's pgTAP half is unverified.
- **Playwright browser mismatch.** The repo pins `@playwright/test` ^1.61 (browser
  build 1228); the image ships 1194, so `pnpm test:e2e:mocked` failed 4/4 on a clean
  tree. Fixed by symlinking `/opt/pw-browsers/chromium-1228` and
  `chromium_headless_shell-1228` onto the 1194 builds — then 4/4 passed. **This is
  environment-side and does not survive a new container; redo it, and do not run
  `playwright install` or edit the Playwright config.**
- **Agent spawns are forced asynchronous here.** `run_in_background: false` is not
  honoured, so an orchestrator's turn ends with its subagent still running. The loop
  still works — one spawn per turn, resume on completion — but it needs an external
  nudge each cycle. Never have two roles in flight at once; the validator mutates the
  working tree.

### Next steps, in order

1. Re-validate and review U3, clear the remaining fallow findings, and replace
   `d860637`'s WIP status with a proper reviewed commit (or a follow-up commit).
2. Run the `stamp()` all-callers sweep.
3. U4 — the Stage 23 summary hook (FR-24.7 / AC7), grouping from live medications.
4. Update `specs/p0-feature-audit.md` (Stage 24 → DONE + sha, P0 #5 → ✅) and the
   spec Status field.
5. Then **Stage 25** (reminder reliability) and **Stage 26** (trust/transparency).
   Note for 25: AC1/AC2 need a real server-sent Web Push and a Supabase subscription
   row, so they are **not verifiable without Docker**; the pure-core half (FR-25.3
   escalation, FR-25.7 prefs, FR-25.8 assume-taken authority) is. Stage 26 is fully
   doable offline.

---

# Handoff — Stage 18 (UX hardening)

_Updated 2026-07-25. Branch: `stage-18-ux-hardening`. Two tracks now live in
parallel: the **React-Aria UI rewrite** (Stages 19–21; Stage 21 dashboards+calendar
is mid-flight — U1 History + U2 Calendar committed, see `4951cd6`) and a new
**P0 feature backlog track** (Stages 22–26). See the P0 section immediately below;
the older Stage-18 history follows it._

---

## P0 feature backlog (handoff item 2) — started 2026-07-25

Took `research/03-feature-list-prioritised-by-category.md`, mapped all **12 P0s**
to build status in **`specs/p0-feature-audit.md`**, authored specs for the
not-built/partial ones, verified the done ones, and shipped the first stage.

**Committed:**

| Commit    | What                                                              |
| --------- | ----------------------------------------------------------------- |
| `3728b48` | P0 audit + Stages **22–26** specs authored                        |
| `62eac7e` | **Stage 22** implemented — medication `strength` + `form` (P0 #3) |
| `e115f81` | **Stage 23** implemented — clinician outputs (P0 #6 + #7)         |

**P0 status:** Done & re-verified bug-free by subagents — #1 grouped schedule,
#2 taken/skipped/late logging, #4 pharmacology extension, #9 local-first storage,
#10 encryption posture. Decisions: #10 met by TLS+at-rest (zero-knowledge stays a
non-goal); **#12 iOS native deferred**. New specs: **22** med metadata (DONE),
**23** clinician outputs = pre-visit summary + portable med list (implements the
never-built Stage 17), **24** occurrence-linked side-effect logging, **25** reminder
reliability, **26** trust/privacy policy.

**Stage 22 — DONE.** `strength?`/`form?` on `Medication`; pure
`medicationLabel()`/`formLabel()`; `validateMedication()` strength trim+cap (40)
with extracted `isDuplicateName`/`guardrailIssues` helpers; editor Strength field

- Form select; Meds list renders the label. Validated in the app.

**Stage 23 — DONE (with the optional Stage 16 regimen markers, per user request).**
Pure `core/clinicalReport.ts` — `buildMedicationList` + `buildPreVisitSummary`
(overall + per-timing-sensitive-med adherence, flare stats with severity/duration
avgs + weekly clustering, in-period regimen changes, descriptive "what to ask"
highlights). UI: a "Clinician outputs" card in History opens either report on a
print-ready white sheet (React Aria overlay, portaled; Print→PDF via `@media
print` isolating `.sd-print-region`; Share via `navigator.share`→`mailto`;
disclaimer). Extracted `useDataset()` + `shareReport()`. 608 tests green;
typecheck/lint clean; fallow gate **passes (warn)** — the residual warn is the
store-subscription idiom `useDataset` shares with the pre-existing
HistoryScreen/OuraPanel (a full clear would mean refactoring those two;
deliberately deferred). Validated live: both reports legible dark-on-white, med
list shows Stage 22 labels, per-med table excludes flexible meds.

**Gotcha discovered (Stage 23):** the design system's `slate` scale is
**inverted and theme-flipping** — `text-slate-900` is the _lightest_ token and
flips with theme. A forced-white print document must use **literal** colours
(`text-[#0f172a]` etc.), not slate tokens; the embedded AdherenceChart keeps its
tokens on a dark figure (`print-color-adjust: exact`).

**Next:** Stage 24 (occurrence-linked side-effect logging) — extends the Stage 15
event system with `medId`/`doseLogEntryId`; feeds Stage 23's summary. Non-blocking
notes from the P0 verification pass are in the audit (§Verification): `late` isn't
an `OccurrenceStatus`; "Take group" offered on upcoming slots; a `loadAll`
first-run check + a round-trip test gap.

_(Local HEAD is ahead of the last push — push before closing.)_

---

## Prior track — Stage 18/19/20/21 (React-Aria UI)

_Stage 20 (screen migration) landed in 5 units — U1 chrome+nav (React
Aria Tabs), U2 Today, U3 the merged Meds editor, U4 Events, U5 logging dialogs +
panels — all validated + reviewer-signed-off, build succeeds, fallow-clean. **Stage
21 (dashboards + calendar)** is mid-flight — `specs/stage-21-dashboards-calendar.md`,
the highest-visual-risk stage with legibility as the explicit acceptance bar. The
former WIP `17e78b7` was validated + signed off earlier (§"Snapshot fix — signed
off")._

Stage 18 turns the UX-bug findings in `specs/stage-18-ux-hardening.md` into fixes.
Every fix goes through a three-role subagent pipeline (see §Method). The spec is
the authority for what "fixed" means; each FR maps to acceptance criteria (ACn).

---

## Snapshot fix (`17e78b7`) — signed off

The FR-18.1 snapshot follow-up (reentrant `begin/endRegimenEdit` depth counter +
`runRegimenEdit` collapsing one Save into one schedule snapshot; `slot.deleted`
filtered at source in `resolveScheduleAsOf`) is now **fully validated and reviewer-
signed-off** (closed out 2026-07-23). All three formerly-outstanding checks passed:

- **Test-mutation audit** — reverting the source (capture-on-every-close; drop the
  `slot.deleted` filter) turns the new `store.test.ts` / `scheduleHistory.test.ts`
  tests red; restored green. Tests are honest, not tautological.
- **Early-return depth safety** — `inRegimenEdit`'s `try/finally` (`store.ts:298`)
  balances the counter even when an inner action early-returns; a later edit still
  records. Proven by `store.test.ts` "nests without losing the snapshot…".
- **Pre-upgrade baseline path** — upgrading a pre-snapshot DB mints the
  `effectiveFrom: 0` baseline and past days resolve correctly. (Known-benign
  StrictMode double-hydrate mints two _content-identical_ baselines — carried-
  forward item below, not a defect.)

Reviewer confirmed: one Save = one snapshot across the six wrapped store actions,
no non-schedule action spuriously mints a snapshot, `src/core` boundary intact,
fallow new-only introduced counts all 0. The commit message still reads "WIP" as a
historical record of its authoring state — that is expected; the sign-off is here.

---

## Committed (branch `stage-18-ux-hardening`, HEAD `f67d9e1`) — Stage 18 COMPLETE

| Commit    | FR / kind   | What                                                                      |
| --------- | ----------- | ------------------------------------------------------------------------- |
| `ff25b2d` | 18.11       | Blood-level chart removed as a user-facing concept                        |
| `5490f97` | 18.1 p1     | Effective-dated ScheduleSnapshot + `resolveScheduleAsOf` + migration 0008 |
| `376804f` | 18.1 p2     | Structured RegimenChange diffs (G1–G4) + migration 0009                   |
| `881885f` | 18.1 p3     | Medication start dates — completes AC3                                    |
| `9c9adf4` | 18.5 + 18.2 | Confirm destructive actions; dose edit/delete                             |
| `54a94eb` | 18.4 + 18.3 | Lateness-aware adherence; skipped status + migration 0010                 |
| `5f5554e` | 18.6        | Assumed vs logged doses made distinguishable                              |
| `21fb651` | 18.12       | Merge the Meds and Schedule tabs                                          |
| `8e2a6de` | docs        | This handoff + the orchestrator playbook                                  |
| `17e78b7` | 18.1 fu     | Snapshot collapse + tombstone filter — **validated + signed off**         |
| `90bf4a1` | 18.7 + 18.8 | Medication save validation (no-empty-schedule, dup names, numerics, cap)  |
| `b82cc61` | 18.10       | Stop raw-id leaks; breach-accurate copy; jargon hints                     |
| `f67d9e1` | 18.9        | Calendar: on-surface breaches, future-drag explained, state legibility    |

**Stage 18 is complete — every FR (18.1–18.12) is implemented, validated
(Playwright + per-rule mutation audit), reviewer-signed-off, and fallow-clean.**
The FR-18.1 structural fix (past days render the regimen as it was _then_) is the
spine; FR-18.12 (tab merge) was added mid-stage per a product decision (spec §11).
The last three FRs went through the full pipeline this session on 2026-07-24.
(Note: local HEAD is ahead of the last push — push before closing; the user's own
`2f04937 react-aria skills` commit sits in the history too.)

---

## Remaining FRs — none

All Stage 18 FRs are done. The last four (FR-18.7, FR-18.8, FR-18.10, FR-18.9)
were completed this session through the full Implement→Validate→Review pipeline:

- **FR-18.7 + FR-18.8** (`90bf4a1`): decided to **block** (not just warn) a
  save with zero scheduled times — no PRN/as-needed concept exists in the model,
  so an unscheduled med would be invisible; validation lives in a pure core
  `validateMedication()` (duplicate names, non-positive numerics, daily-total vs
  cap), the editor only renders the messages.
- **FR-18.10** (`b82cc61`): fixed **9** raw-id fallback sites (not just the two in
  the spec), added additive core `classifyGuardrailBreach`/`guardrailAckLabel` so
  breach copy is accurate (also fixed the same hardcoded "over-cap" tag in the
  History dose-log row), and added jargon hints via a `Field hint` prop.
- **FR-18.9** (`f67d9e1`): calendar breach chips, future-retime now explained
  (clamp-to-now kept for clinical safety, but surfaced in both loggers on every
  future-producing path), and missed/upcoming/assumed made distinct by border
  style + glyph + accessible name (extends FR-18.6). Extracted `TimeTakenField`.

Spec §7 open questions were all settled earlier (assume-taken on with distinct
rendering; on-time window global default; snapshots approach (b); tabs merged →
FR-18.12).

---

## Method (how each FR is done)

Per FR, spawn three subagents in sequence, synchronously (they share one Playwright
browser). Each applies fixes it can and reports what it can't:

1. **IMPLEMENTER** — writes the fix + tests.
2. **VALIDATOR** — drives the real app in Playwright, mutation-tests that the new
   tests actually fail against broken code, audits test honesty.
3. **REVIEWER** — reviews the diff and **clears the fallow commit gate**.

Shared protocol: `<scratchpad>/FIX-PROTOCOL.md`
(`/private/tmp/claude-501/-Users-ankoor-Code-projects-med-tracker/ab9a0459-f30f-485f-81be-cfcf1f0e5dab/scratchpad/FIX-PROTOCOL.md`).
Sonnet for most roles; Opus only for architecturally hard implementers (used it for
FR-18.1 pieces and the tab merge). Commit each FR separately.

_Note: the scratchpad path is session-specific and will not survive a new session.
Its key contents are reproduced in this handoff; re-create the protocol file if a
fresh session needs the subagents._

### Gotchas (all learned the hard way)

- **`git diff` hangs** on the pager → use `git --no-pager diff`.
- **Commit messages:** write to a file, `git commit -F <file>` (apostrophes break
  `<<'EOF'` heredocs), and run the commit with **`run_in_background: true`** — the
  pre-commit hook (lint-staged + typecheck + **fallow audit**) exceeds the 2-min
  foreground timeout on this codebase.
- **fallow commit gate is "new-only":** you need `*_introduced` counts at 0, not
  the inherited ones. Prefer real fixes (extract helpers, add branch coverage) over
  `// fallow-ignore` suppressions; suppression syntax is fiddly (see `.claude/skills/fallow`).
- `.claude/` is in `.prettierignore` now — but prefer `npx prettier --write "src/**/*.{ts,tsx}"`.
- **Local stack:** `pnpm local:reset` before browser validation to apply new
  migrations (0008–0010 exist) and get clean seed data. Dev server runs on :5173.
- A subagent whose Agent call was _rejected_ mid-turn sometimes still left work on
  disk — always `git status` after an interrupt before spawning a replacement.

---

## Carried-forward open items (non-blocking)

- **StrictMode / two-tab double-hydrate** can mint two `effectiveFrom: 0` baseline
  snapshots. Root cause: `migrations.ts` v2 baseline mint isn't serialized against
  concurrent `loadAll()` (`App.tsx` hydrate effect fires twice under StrictMode).
  Benign — both baselines are content-identical, so the resolver tiebreak between
  them is inconsequential. NOT fixed by the uncommitted snapshot collapse (that
  guards the edit path, not the migrate/hydrate path).
- **Same-millisecond ties across two _separate_ user actions** still resolve by
  UUID after the snapshot-collapse fix. Not hand-reachable; only matters for
  programmatic/import loops. Closing it needs a monotonic sequence field (a
  migration), which the user declined.
- **`medication-reactivated`** shares the `bg-accent` marker colour with
  `medication-added` (distinguished only by popover label). Deliberate deferral;
  user may want them visually distinct.
- **"Rendered more hooks" console errors** seen intermittently during validation —
  investigated three times, traced to Vite HMR mid-edit (once paired with
  "TodaySummaryCard is not defined"). Not a product defect; does not reproduce on a
  clean load.

---

## Queued next (user request, not started)

### 1. UI rewrite onto React Aria Components — Stages 19–21 (specs written)

Rebuild the UI on **React Aria Components** (`react-aria-components`) under a new
**minimalistic, clean theme**, dropping the fully-custom components + Oura-style
CSS. **Decision made and recorded** (spec 19 §2): React Aria Components over React
Spectrum S2 — the requirement is a _bespoke_ theme, so we want unstyled primitives
we fully own, not Adobe's Spectrum design language; it is also the lower-risk
migration and ships the primitives this app needs (`Calendar`, `DateField`/
`TimeField`/`NumberField`, `Dialog`, `Meter`). The `react-aria` skill is installed
(`spectrum-audit`/`react-spectrum-s2` are not applicable — we did not adopt S2).

Three stages, run in order through the Implement→Validate→Review pipeline:

- **Stage 19 — `specs/stage-19-design-system-react-aria.md`. ✅ DONE.** CSS-custom-
  property token layer (light+dark, AA), `Button`/`Modal`/`ConfirmDialog` over React
  Aria (source-compatible exports; `Field`/`Card`/`ColorDot`/`Ring`/`Stat`/
  `StatusBadge` kept presentational), Oura _style_ directive dropped (data feature
  intact), Lucide icons, `@react-aria/test-utils` wired, dev-only theme guide at
  `?themeguide`. §5 decisions settled (CSS-var tokens, Lucide, Tailwind+`data-*`).
  Two committed transients cleared: the test-utils dep is now consumed; the
  tokens.css dark-palette duplication remains documented (dual-signal theming; a
  DRY `var()` indirection can't be verified under jsdom — revisit if a build-level
  token test is added).
- **Stage 20 — `specs/stage-20-screen-migration.md`. ✅ DONE.** 5 units: U1 chrome +
  bottom nav → React Aria `Tabs` (root-caused a recurring "no tab id" console.error
  to JSX order — `TabList` before `TabPanels`); U2 Today (token cleanup — already on
  the primitives); U3 the merged Meds editor onto `Form`/`NumberField`/`TimeField`/
  `Select` with FR-18.8 validation as accessible `FieldError`s (FR-20.4), AC14
  change-records mutation-proven; U4 Events (added its first test file + shared
  `ModalFormFooter`); U5 logging dialogs + panels (new `DateField`/`dateValue`,
  `NumberField` doses; caught a `RemindersPanel` NaN-leak). New shared primitives:
  `fields.tsx`, `timeValue.ts`, `dateValue.ts`, `ModalFormFooter.tsx`. A hard
  `.claude/hooks/fallow-gate.sh` PreToolUse hook blocks git ops while any fallow
  `*_introduced` > 0 — keep reviewers clearing it (extract, don't suppress).
- **Stage 21 — `specs/stage-21-dashboards-calendar.md`. ← NEXT.** History dashboards +
  Calendar onto the theme, with **legibility as the explicit acceptance bar** (the
  "easily understood dashboards and calendars" ask). Guards that the FR-18.6/18.9
  visual distinctions and their non-colour cues survive the re-skin, and that the
  calendar drag/arrow-retime still works.

_The Oura **data** feature (`OuraPanel`, `core/oura.ts`) is untouched — only the
Oura visual *style* is dropped._

### 2. P0 feature stages — from the research backlog

Take `research/03-feature-list-prioritised-by-category.md`, find all **P0** items,
and author new spec stages from them, grouped appropriately. Keep already-completed
P0s in the spec but reference where they were completed. Then spawn subagents to
verify those "completed" P0 features are actually valid/bug-free. Then start the
Implement→Validate→Review cycle on the next stage.
_(That file has not been read yet — confirm it exists and scope the work first.)_

---

## Quick health check for whoever picks this up

```
git status                 # expect clean (everything committed + pushed)
git log --oneline -10      # Stage 19 Unit 3 at HEAD, pushed
pnpm typecheck && pnpm lint && pnpm test   # expect green (570 tests)
pnpm db:test               # expect 79 pgTAP green (needs local stack up)
```
