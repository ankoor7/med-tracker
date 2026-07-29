# Agent trial protocol — shared harness

Both agent-stage trials run against the **same subject** so their results are comparable to
each other and to the one existing measured baseline. This file holds what they share;
`agent-stage-1-*.md` and `agent-stage-2-*.md` hold what differs.

## 1. Subject: Stage 25, units 1–3

| | |
| --- | --- |
| **Spec** | `specs/stage-25-reminder-reliability.md` |
| **Units** | FR-25.3 (pure-core escalation chain) → FR-25.7 (escalation prefs + migration) → FR-25.4 (persistent/collapsing notifications) |
| **Start commit** | `a3e5ae3` (merge-base used by the baseline run) |
| **Reference implementation** | branch `exp/stage25-review-a` — 3 commits, green, 699 tests |

### Why this subject

- **Identical starting conditions.** The baseline was measured on exactly these units from
  exactly this commit, so cost deltas are a true A/B rather than an approximate one.
- **Right size.** Three units, one bounce, ~9.5h — enough to exercise the full loop (including
  send-work-back) without a multi-day run.
- **No Docker.** All three are reachable local-first; the real E2E suite is not required.
- **A reference implementation exists.** `exp/stage25-review-a` shows one correct outcome, so a
  trial run that goes badly wrong is obvious immediately.

### What "re-run" means

Each trial starts a **fresh worktree from `a3e5ae3`** and rebuilds the three units from the
spec. It does **not** replay the existing diffs — the implementers must do the work again, or
the validator and reviewer have nothing real to act on.

Consequence: **the trial's code will differ from the reference.** That is expected and is why
the acceptance criteria in both specs are written against *cost and process* metrics plus
*defect-detection parity*, not against reproducing a specific diff.

## 2. Known defect catalogue

The baseline run surfaced these in this work. They are a **watch list, not a scoring rubric** —
a different implementation may not reproduce them.

| # | Defect | Where | Caught by | Notes |
| --- | --- | --- | --- | --- |
| D1 | Comment claims a migration "lives in `prefs.ts`" that does not exist | `src/core/reminders.ts` (unit 1) | reviewer (OCR arm only) | Now covered by the REVIEWER role's "chases claims made in the code" clause |
| D2 | `catch` branch returns bare defaults → escalation ON for a corrupted *existing* install | `src/reminders/prefs.ts` (unit 2) | reviewer only | **Neither live testing nor mutation testing reached it** — the branch was never constructed |
| D3 | `v >= 2` blob missing `escalationEnabled` silently defaults ON | `src/reminders/prefs.ts` (unit 2) | reviewer | Unreachable via shipped write paths; latent |
| D4 | `if (!raw)` treats an empty stored string as a new install | `src/reminders/prefs.ts` (unit 2) | implementer, during bounce | Found only because the review triggered a bounce |
| D5 | Module-level `DEFAULT_REMINDER_PREFS` singleton handed into live React state | `prefs.ts`, `useReminders.ts` (unit 2) | reviewer (applied fix) | Latent bug class, not a live bug |
| D6 | `tag: reminder.id` scoped per reminder, not per occurrence → re-alerts stack | `src/reminders/notifications.ts` | implementer (unit 1), fixed unit 3 | Routed forward correctly |

**How to use it.** If a trial run reproduces a defect class, the pipeline should catch it. If a
trial run catches *nothing* across three units, that is a red flag for defect-detection parity
even though the count technically matches a zero-finding baseline unit — investigate whether the
implementation genuinely is clean or the checks got weaker.

D2 is the single most important row: it is the case that justifies having a reviewer at all.

## 3. Contamination controls

The repo now contains material that **describes the answers**: `research/04–06`, this file, and
the two agent specs. An implementer or reviewer that reads them is no longer doing the task
blind, and defect-detection parity becomes meaningless.

**Required isolation.** The trial worktree MUST NOT expose:

- `research/04-agent-review-stage-ab-test.md`
- `research/05-agent-token-economics.md`
- `research/06-agent-orchestration-efficiency.md`
- `specs/agent/**` (including this file and the known-defect catalogue)

The orchestrator reads its own trial spec; **role agents must not**. Achieve this by removing
those paths in the trial worktree before the first spawn, and confirming with a grep that no
directive quotes them.

**Deliberately not isolated:** the REVIEWER role's "chases claims made in the code" clause
(added to `.claude/agents/sequential-fix-orchestrator.md` after the baseline). It is a permanent
method improvement, not trial scaffolding. Note it when interpreting D1: if the trial catches
D1 and the baseline's arm A did not, that clause is the likely cause, not the trial change.

## 4. Controls held constant

Changing any of these invalidates the comparison:

| Control | Value |
| --- | --- |
| Start commit | `a3e5ae3` |
| Units and order | FR-25.3 → FR-25.7 → FR-25.4 (dependency order, not spec order) |
| Orchestrator model | `opus` |
| Validator / reviewer model | `claude-sonnet-5` |
| Implementer model | `opus` permitted (see below) |
| Green-build command | `pnpm typecheck && pnpm lint && pnpm test` |
| Commit gate | `.claude/hooks/fallow-gate.sh` active |
| Environment | no Docker, no Supabase stack, dev server local-first |
| Capture | base / pre-review / post-review patch per unit, as in the baseline |

**Model selection is the easiest control to lose**, and the baseline already lost part of it. This
table originally pinned every role to `claude-sonnet-5`; measurement showed all three baseline
implementers actually ran on `claude-opus-5`. That was not a slip — the orchestrator was following
its own "Model selection" doctrine, which reserves the top-tier model for implementers doing
architecturally hard work, and it produced implementations the pipeline was happy with.

The control is therefore **amended to match reality** rather than overriding the doctrine:
implementers may run on opus. In exchange, two requirements:

- **Report cost segmented by model.** `scripts/measure-agent-tokens.py` prints the model per
  agent and prices per-model by default. A run that does not state which roles ran on which model
  has not reported its result.
- **Never compare across pricing conventions.** Opus is ~2.5× Sonnet per token, so a role that
  moves between tiers between runs swamps any method effect. If a trial's implementers land on a
  different tier than the baseline's, say so and treat the implementer delta as uninterpretable.

Validator and reviewer stay pinned to `claude-sonnet-5`; promoting either invalidates the run.

## 5. Sequencing

Run the trials **one at a time**, not together.

**Recommended order: Stage A2 (validator) first, then A1 (orchestrator).**

Rationale: the validator changes are internal to the VALIDATOR directive and do not alter how
other roles are briefed, so their effect is cleanly attributable. The orchestrator changes —
particularly FR-A1.1 (per-unit context reset) and FR-A1.3 (thin orchestrator, delegates reading)
— change what every role is told, and FR-A1.3 could plausibly *increase* validator `Read` calls.
Measuring A1 on top of a settled A2 is interpretable; measuring both at once is not.

| Run | Config | Purpose |
| --- | --- | --- |
| 0 | baseline (already measured 2026-07-28, corrected 2026-07-29) | reference |
| 1 | A2 only | validator turn/context reduction |
| 2 | A1 + A2 | orchestrator cache/context, on the improved validator |

> **A1's changes are already committed to `.claude/agents/sequential-fix-orchestrator.md`.** The
> measurement harness (FR-A1.6) was a prerequisite for measuring *either* stage, so A1 was built
> first even though it runs second. Consequence: **the run-1 worktree must not inherit them.**
> Build its agent file from the pre-A1 commit plus the A2 validator changes, and diff it against
> the A1 version before the first spawn to confirm no orchestrator-side change leaked in. A run-1
> that silently carries the per-unit context reset is measuring both stages at once, which §5
> exists to prevent.

Two additional full runs ≈ 2 × ~$21 at baseline cost, less if the trials work. Budget for the
possibility that run 1 fails its revert conditions and needs a repeat.

## 6. Reporting

Each trial produces, in `research/`:

- the per-role cost table (from `scripts/measure-agent-tokens.py`), cost-weighted;
- per-agent turns, tools-per-turn, avg context/turn, cache write:read;
- every acceptance criterion marked pass/fail with its measured number;
- any revert condition that fired, and what was reverted;
- the learnings entries produced under `FR-A1.5`.

**Report failures as findings.** A trial that misses its target and gets reverted has produced a
real result: it says the baseline design was load-bearing for a reason not previously understood.
That is worth more than a marginal cost win.

## 7. Threats to validity

- **n = 1 baseline.** Single-run variance is unmeasured. Treat a <15% delta as noise unless it
  reproduces.
- **Implementation differs each run.** A cheaper run may simply have built something simpler.
  Cross-check against test count and acceptance-criteria coverage, not cost alone.
- **The reviewer changed after the baseline.** See §3.
- **The known-defect catalogue may not recur**, which weakens parity checking. If a run produces
  a materially cleaner implementation, defect *counts* are not comparable — fall back to
  comparing whether each acceptance criterion was genuinely exercised.
