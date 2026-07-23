# Handoff — Stage 18 (UX hardening)

_Written 2026-07-23. Branch: `stage-18-ux-hardening`. Everything is committed **and
pushed** — tree clean, HEAD `17e78b7`. One committed unit is WIP (not review-signed-
off): read §"Unfinished work" first._

Stage 18 turns the UX-bug findings in `specs/stage-18-ux-hardening.md` into fixes.
Every fix goes through a three-role subagent pipeline (see §Method). The spec is
the authority for what "fixed" means; each FR maps to acceptance criteria (ACn).

---

## ⚠️ Unfinished work — the first thing to deal with

Commit **`17e78b7`** (the FR-18.1 snapshot follow-up) is committed and pushed **but
is WIP** — implemented and green, but validation was only PARTIAL and it had **no
reviewer pass**. Its commit message says so; it is isolated in its own commit so it
is easy to finish, amend, or revert. Close it out before building on this area.

Files in that commit:

```
src/core/scheduleHistory.ts          # tombstone filter in resolveScheduleAsOf
src/core/scheduleHistory.test.ts
src/store/store.ts                   # reentrant begin/endRegimenEdit + runRegimenEdit
src/store/store.test.ts
src/ui/screens/MedicationEditor.tsx  # Save wrapped in runRegimenEdit
src/ui/screens/MedsScreen.test.tsx   # re-enabled Today-grouping test
```

**What it fixes (two bugs in earlier FR-18.1 code):**

1. **Live bug** — every mutating store action appended a schedule snapshot stamped
   `Date.now()`, and one Save in the merged editor fires 2–4 of them in the same
   millisecond. `resolveScheduleAsOf` broke ties by random UUID, so a past day
   could render a **mid-edit regimen that never existed**. Fix: collapse a
   bracketed edit into **one snapshot per Save** (reentrant depth counter +
   `runRegimenEdit` wrapping `MedicationEditor.save`). Also retires the deferred
   "unbounded snapshot growth" item.
2. **Latent bug** — `resolveScheduleAsOf` never filtered `slot.deleted`. Inert
   today (downstream `plannedSlotsForDate` filters deleted slots), fixed anyway.

**To finish it:** run the outstanding validation — the pre-upgrade baseline path,
the early-return depth-leak provocation (worst blast radius: a leaked depth counter
silently stops ALL future snapshot recording), and the Part 2 test-mutation audit —
then a reviewer pass, then amend/commit. Already live-passed: past-day render after
a multi-action retime, one-Save-one-snapshot, FR-18.1 ACs, FR-18.12 AC14 records,
tombstone filter, console clean.

---

## Committed & pushed (branch `stage-18-ux-hardening`, HEAD `17e78b7`)

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
| `17e78b7` | 18.1 fu     | **WIP** — snapshot collapse + tombstone filter (see §Unfinished work)     |

The FR-18.1 structural fix (past days must render the regimen as it was _then_,
not the current one) is the spine of the stage and is done. FR-18.12 (tab merge)
is a new FR added mid-stage per a product decision — see spec §11.

---

## Remaining FRs (spec §10 order)

The merged editor (FR-18.12) is now the home for the next three, so they land there:

1. **FR-18.7 — a medication must not be silently left unscheduled/invisible.**
   Largely handled by the merge (adding + scheduling are one flow), BUT a real gap
   remains: `MedicationEditor.tsx` `canSave` uses `rows.some(...)`, vacuously false
   at `rows.length === 0`, so a medication CAN still be saved with no times —
   mitigated only by a passive warning. Decide: is the warning enough, or block it?
2. **FR-18.8 — form validation.** Duplicate medication names, negative/zero
   numerics, and daily-total vs `maxDailyDose`. The daily-total check is now trivial
   because one component holds every slot dose _and_ the cap (was impossible across
   the old split).
3. **FR-18.10 — raw-id leak** carried into `SlotEditor.tsx` (a reviewer already
   fixed one occurrence there; check for others), guardrail-button copy ("Log
   over-cap dose" fires for min-interval breaches too), and inline explanations for
   jargon (half-life, min interval) following the "timing-sensitive" pattern.
4. **FR-18.9 — calendar** (independent of the merge): surface guardrail breaches
   on the calendar surface itself; fix the silent future-drag clamp in
   `GroupLogger.tsx` (dragging a future dose silently substitutes "now"); make
   missed / upcoming / assumed visually distinct.

Spec §7 open questions are all settled and marked in the spec (assume-taken stays
on with distinct rendering; on-time window is global default 60 min; snapshots
approach = (b); tabs merge = yes → FR-18.12).

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

- **Stage 19 — `specs/stage-19-design-system-react-aria.md`.** Foundation:
  design-token layer for the new theme (light+dark), themed primitives over React
  Aria replacing `ui.tsx`/`Modal.tsx`/`ConfirmDialog.tsx`/`StatusBadge.tsx`, drop
  every Oura-style directive, wire `@react-aria/test-utils`, a theme guide. No
  screen rewrites. Has open questions in §5 (token home, icon set, Tailwind vs
  React Aria styling) — settle with the user before/early in the stage.
- **Stage 20 — `specs/stage-20-screen-migration.md`.** Migrate chrome, Today, the
  merged Meds editor, Events, and the logging dialogs onto the new primitives.
  **Behaviour parity is load-bearing**: every Stage 18 FR must survive (FR-20.2
  lists them); the Stage 18 test suite is the oracle.
- **Stage 21 — `specs/stage-21-dashboards-calendar.md`.** History dashboards +
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
git log --oneline -10      # expect 17e78b7 at HEAD, pushed
pnpm typecheck && pnpm lint && pnpm test   # expect green (478 tests)
pnpm db:test               # expect 79 pgTAP green (needs local stack up)
```
