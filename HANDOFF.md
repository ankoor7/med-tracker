# Handoff — Stage 18 (UX hardening)

_Written 2026-07-23. Branch: `stage-18-ux-hardening`. 9 of 12 FRs committed **and pushed**.
One fix sits uncommitted in the working tree — read §"Uncommitted work" first._

Stage 18 turns the UX-bug findings in `specs/stage-18-ux-hardening.md` into fixes.
Every fix goes through a three-role subagent pipeline (see §Method). The spec is
the authority for what "fixed" means; each FR maps to acceptance criteria (ACn).

---

## ⚠️ Uncommitted work — the first thing to deal with

The working tree holds an **FR-18.1 follow-up** (schedule-history correctness),
6 files, **not committed and not pushed**:

```
M src/core/scheduleHistory.ts        # tombstone filter in resolveScheduleAsOf
M src/core/scheduleHistory.test.ts
M src/store/store.ts                 # reentrant begin/endRegimenEdit + runRegimenEdit
M src/store/store.test.ts
M src/ui/screens/MedicationEditor.tsx # Save wrapped in runRegimenEdit
M src/ui/screens/MedsScreen.test.tsx  # re-enabled Today-grouping test
```

**What it fixes (two bugs in already-committed FR-18.1 code):**

1. **Live bug** — every mutating store action appended a schedule snapshot stamped
   `Date.now()`, and one Save in the merged editor fires 2–4 of them in the same
   millisecond. `resolveScheduleAsOf` broke ties by random UUID, so a past day
   could render a **mid-edit regimen that never existed**. Fix: collapse a
   bracketed edit into **one snapshot per Save** (reentrant depth counter +
   `runRegimenEdit` wrapping `MedicationEditor.save`). Also retires the deferred
   "unbounded snapshot growth" item.
2. **Latent bug** — `resolveScheduleAsOf` never filtered `slot.deleted`. Inert
   today (downstream `plannedSlotsForDate` filters deleted slots), fixed anyway.

**Status: implementer done (reported 478 tests + 79 pgTAP green, fallow clean).
Validation is PARTIAL. No reviewer pass. DO NOT COMMIT until finished.**

- Live-passed: past-day render after multi-action retime, one-Save-one-snapshot,
  FR-18.1 ACs, FR-18.12 AC14 records, tombstone filter, console clean.
- **Not done:** pre-upgrade baseline path (item 3), the early-return depth-leak
  provocation (item 4 — worst blast radius: a leaked depth counter silently stops
  ALL future snapshot recording), and the Part 2 test audit + mutation test.

**To resume:** finish those validation items, then a reviewer pass (which must
also clear the fallow gate), then commit + push. The full validator brief is in
the conversation; the protocol is in the scratchpad (§Method).

If you'd rather not resume mid-validation, `git stash` it and pick a fresh FR —
but the fix is worth keeping; bug 1 was genuinely user-visible.

---

## Committed & pushed (branch `stage-18-ux-hardening`)

| Commit    | FR          | What                                                                      |
| --------- | ----------- | ------------------------------------------------------------------------- |
| `ff25b2d` | 18.11       | Blood-level chart removed as a user-facing concept                        |
| `5490f97` | 18.1 p1     | Effective-dated ScheduleSnapshot + `resolveScheduleAsOf` + migration 0008 |
| `376804f` | 18.1 p2     | Structured RegimenChange diffs (G1–G4) + migration 0009                   |
| `881885f` | 18.1 p3     | Medication start dates — completes AC3                                    |
| `9c9adf4` | 18.5 + 18.2 | Confirm destructive actions; dose edit/delete                             |
| `54a94eb` | 18.4 + 18.3 | Lateness-aware adherence; skipped status + migration 0010                 |
| `5f5554e` | 18.6        | Assumed vs logged doses made distinguishable                              |
| `21fb651` | 18.12       | Merge the Meds and Schedule tabs                                          |

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

## Queued after Stage 18 (user request, not started)

Take `research/03-feature-list-prioritised-by-category.md`, find all **P0** items,
and author new spec stages from them, grouped appropriately. Keep already-completed
P0s in the spec but reference where they were completed. Then spawn subagents to
verify those "completed" P0 features are actually valid/bug-free. Then start the
Implement→Validate→Review cycle on the next stage.
_(That file has not been read yet — confirm it exists and scope the work first.)_

---

## Quick health check for whoever picks this up

```
git status                 # expect the 6 uncommitted files above, nothing else
git log --oneline -8       # expect 21fb651 at HEAD, pushed
pnpm typecheck && pnpm lint && pnpm test   # expect green (478 tests with the WIP)
pnpm db:test               # expect 79 pgTAP green (needs local stack up)
```
