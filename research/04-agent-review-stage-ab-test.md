---
title: 'Review-stage A/B — current reviewer vs open-code-review-delegate'
date: 2026-07-28
tags: [agents, code-review, evaluation, sequential-fix-orchestrator, ab-test]
status: complete
---

# Review-stage A/B — Current Reviewer vs `open-code-review-delegate`

_Controlled experiment on the `sequential-fix-orchestrator` REVIEWER stage, run against
Stage 25 (Reminder Reliability) units 1–3. Companion notes:
[[05-agent-token-economics]], [[06-agent-orchestration-efficiency]]._

---

## TL;DR

- **Verdict: keep the current reviewer.** On byte-identical diffs at effectively identical
  cost ($1.682 vs $1.685 — 0.2% apart), the current reviewer found **3 real issues plus a
  latent bug class** and triggered a bounce that surfaced a 4th defect. The OCR arm found **1**.
- The result was **not** a clean sweep. OCR won unit 1 on a genuine, shipped defect that the
  current reviewer traced and then dismissed as out of scope. That single finding is the
  strongest argument in the skill's favour, and it is reproducible **as a one-line prompt
  change** without adopting the skill.
- **Cost was a wash**, which was the most surprising outcome. Review cost tracks _depth of
  investigation_, not workflow. In both units where one arm found more, that arm spent more.
- OCR's rule file behaved as a **checklist floor, not a discovery mechanism**. Arm B missed
  unit 2's defect _while holding a rule that named the defect class_.
- OCR's default file selection **silently excludes test files**. For a stage whose headline
  criterion is mutation-proven test behaviour, that is disqualifying unless overridden.
- Finding counts are a **bad primary metric** for this pipeline. The current reviewer's
  highest-value output on unit 1 was a deferred note that scored `FINDINGS: 0` and directly
  shaped the next unit's design.

---

## 1. Why a controlled design was necessary

The obvious experiment — run the stage twice, once per reviewer — is confounded. Implementers
are non-deterministic, so the two arms would produce different diffs, and "reviewer B found
more bugs" becomes indistinguishable from "implementer B wrote worse code".

The design that isolates the variable is **hold the diff constant**:

```
arm A:  spec → IMPLEMENTER → VALIDATOR → [capture patch + SHA] → REVIEWER → commit
                                              │
                                              ▼
arm B:  reset to arm A's base → apply same patch → OCR REVIEWER
```

Arm B never implements. It reviews the exact bytes arm A's reviewer saw.

| Control                   | Evidence                                                                       |
| ------------------------- | ------------------------------------------------------------------------------ |
| Same diff                 | SHA-256 match per unit; normalised hunk bytes equal (18,420 / 30,988 / 25,942) |
| Same model                | Both on `claude-sonnet-5` — arm A's own choice under its mid-tier doctrine     |
| Same conventions          | Both given `CLAUDE.md` rules and the unit's acceptance criteria by ID          |
| Only the reviewer differs | Forked agent file differs in exactly 3 hunks, all in the REVIEWER role         |
| No scaffolding leakage    | Experiment files committed out of the working tree before review               |

**The comparison is deliberately biased toward arm B.** Its `.opencodereview/rule.json` was
hand-tuned for this repo (10 rules), and the forked agent added two guards the skill ships
without. Results below are an upper bound on the skill's performance, not a floor.

---

## 2. Results

|                              | Arm A (current)      | Arm B (OCR delegate) |
| ---------------------------- | -------------------- | -------------------- |
| **Findings**                 | **3** (1 med, 2 low) | **1** (1 high)       |
| Reviewer-applied fixes       | 1                    | 0                    |
| Bounces triggered            | 1                    | 0                    |
| Tokens (3 comparable passes) | 4,854,122            | 5,117,755            |
| **Cost**                     | **$1.682**           | **$1.685**           |
| Tool calls                   | 90                   | 102                  |
| Commit gate cleared          | 3/3                  | 3/3                  |
| False positives              | 0                    | 0                    |

Per unit:

| Unit                                 | Arm A            | Arm B    | Winner |
| ------------------------------------ | ---------------- | -------- | ------ |
| 1 — FR-25.3 pure-core escalation     | 0                | 1 (high) | **B**  |
| 2 — FR-25.7 prefs + migration        | 3 (1 med, 2 low) | 0        | **A**  |
| 3 — FR-25.4 collapsing notifications | 0                | 0        | tie    |

---

## 3. Unit 1 — where OCR won

The implementer wrote, in `src/core/reminders.ts`:

```ts
// New-install defaults (FR-25.7). Existing installs migrate with escalation
// OFF — that migration lives in `src/reminders/prefs.ts`, not here.
escalationEnabled: true,
```

`prefs.ts:loadPrefs()` spread-merged `{...DEFAULT_REMINDER_PREFS, ...parsed}` with **no
migration, no version stamp, no upgrade path** (`grep -Ei 'migrat|version|schema|upgrade'` →
nothing). The comment asserted a safety mechanism that did not exist.

Arm B opened `prefs.ts` and checked. Arm A found the same mechanism, reasoned about it at
length, and concluded:

> "there is no migration logic anywhere in this diff, so this is expected, not a defect
> introduced here"

Arm A never checked the comment. This is exactly the failure its own agent file warns about
under _Hard-won lessons_:

> **A subagent's self-assessment is a claim to verify, not a fact to relay.**

**Both positions are defensible on scope** — the migration genuinely was unit 2's job, and
unit 2 did deliver it. But the diff as committed (`a8def80`) contained a false comment, and a
false comment asserting a safety property is a defect in its own right. It will read as
reassurance to the next person who doesn't independently check.

### Why this does not justify adopting the skill

Arm B's own honest assessment, when asked directly:

> "I had already started tracing the value and its interaction with `prefs.ts` before pulling
> rules (the implementer's own comment pointing at `prefs.ts` is what made me go read that
> file), so I can't credit the rule with the _discovery_."

The win came from **checking a comment against the code it described**, not from OCR's rule
resolution. That behaviour is one line of prompt.

---

## 4. Unit 2 — where the current reviewer won decisively

Arm A's medium finding is the most valuable in the entire run:

```ts
} catch {
  return DEFAULT_REMINDER_PREFS;   // escalationEnabled: true
}
```

Every other branch in `loadPrefs` forces `escalationEnabled: false` when it cannot prove the
blob is post-migration. The `catch` did not. **Unit 2 never touched that branch** — unit 1
changed what it _produces_ by adding `escalationEnabled: true` to the defaults object. A
corrupted blob from an existing install silently gains escalation: precisely the outcome
FR-25.7 exists to prevent.

The test passed because it asserted `toEqual(DEFAULT_REMINDER_PREFS)` — tracking the default
rather than the intent.

This is the orchestrator's other hard-won lesson firing:

> **When a shared type's meaning shifts, audit every consumer.** Changing what a field
> _means_ compiles clean and slips past tests that were only updated for shape.

**Neither live testing nor mutation testing could reach it.** Arm A's own validator drove the
migration end-to-end successfully and killed all six of its mutations — because the
corrupt-JSON branch was never constructed. It took static reasoning about what the code _can_
do. This is direct empirical support for the doctrine's claim that review and validation
catch different bug classes.

**Arm B missed it while holding a rule that named the defect class.** Its rule file says:
_"flag any migration that changes behaviour for an existing install without an explicit
opt-in."_ Arm B traced the primary path (`no v` → `false`), confirmed AC7, and stopped.

That is the single most important observation in this experiment: **a checklist directs
attention but does not drive branch enumeration.**

---

## 5. What finding counts miss

Two effects invisible to any tally, both favouring the current reviewer.

### 5.1 A zero-finding review shaped the next unit

Arm A's unit-1 reviewer scored `FINDINGS: 0` but wrote in its concerns section that a
partial-write race means _"no escalation keys in the stored blob" cannot be reliably read as
"pre-stage-25 install"_.

Unit 2's implementer then chose a **version stamp over key-sniffing**, citing that reasoning
verbatim in the shipped code:

> "Why a version rather than sniffing for the absence of the escalation keys: a `setPrefs`
> call that races the initial `loadPrefs()` used to persist a _partial_ blob… A stamped
> version is unambiguous."

A finding count records this as zero value. It produced a materially more robust migration.

### 5.2 The bounce compounded

Arm A's 3 findings triggered one bounce, which produced:

- both bounced findings fixed;
- **a fourth defect the reviewer had not flagged** — `if (!raw)` treated an empty stored
  string as a brand-new install, when a written-but-empty value is a corrupted _existing_
  install;
- a `withEscalationOff()` extraction routing all four "unprovable consent" branches through
  one function, removing the defect class rather than patching instances;
- 4 new tests, mutation-proven (5 failed / 20 passed under mutation, 25/25 restored).

Arm A's reviewer also **applied** a fix it did not count: three sites handed the module-level
`DEFAULT_REMINDER_PREFS` singleton into live React state rather than a clone. It traced every
consumer, confirmed none mutate in place today, and reported it honestly as a _latent bug
class, not a live bug_ — good calibration, neither inflated nor ignored.

Arm B applied nothing and bounced nothing across all three units.

---

## 6. What OCR actually contributes

Both arm B reviewers were asked to assess the skill honestly, and both were consistent:

| Component                   | Verdict                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ocr delegate preview`      | **Genuinely useful.** Deterministic, complete file scope with explicit exclusion reasons. Rated the most valuable part by arm B's unit-3 reviewer. |
| `ocr delegate rule`         | Checklist floor. "Mostly restated what I'd have checked anyway given CLAUDE.md and the acceptance criteria." No discovery credited to a rule.      |
| File-scoped rule attachment | **Actively risky** — see below.                                                                                                                    |

### 6.1 File-scoped rules can misdirect

On unit 1, the migration rule was attached to `useReminders.ts` (a one-line diff) — not to
`prefs.ts` (where the bug lived, and which was _not in the reviewable set_ because it was
untouched), and not to `reminders.ts` (where the false comment lived). Arm B's own note:

> "A reviewer relying on 'resolved rules only apply to their attached file' would have had the
> right checklist item sitting on the wrong file and could plausibly have checked 'prefs
> migration: N/A, this file only changes a fallback object' and moved on."

On unit 3 the `src/reminders/**` rule group was a **mismatch** — tuned for subscription
lifecycle and migrations, neither of which that diff touched.

**Structural limitation:** OCR reviews the _changed_ file set. A bug whose cause sits in an
unchanged file is outside its scope by construction. Reaching it requires following a
cross-reference out of the diff — which the rule step does not prompt for.

### 6.2 Two silent configuration traps

**Tests are excluded by default.** OCR's built-in allowlist hard-excludes `**/*.test.ts`,
`**/*.spec.*`, `**/__tests__/**`. Before the `include` override, `preview` reported
`5 reviewable / 7 total`. Unit 1's headline criterion (AC3) is _mutation-proven test
behaviour_ — a stock-config reviewer would have reviewed the implementation while never
opening the tests meant to prove it. **`preview` reports success either way.**

**Rules are first-match-wins in declaration order.** The initial rule file had
`src/core/**/*.ts` above the test rule, so `src/core/reminders.test.ts` resolved to the
core-purity rule and never received the test-honesty checklist. `ocr rules check` displayed a
perfectly successful resolution — to the wrong rule.

---

## 7. Recommendation

**Do not replace the REVIEWER stage.**

**Steal one line.** Add to the REVIEWER role in
[`.claude/agents/sequential-fix-orchestrator.md`](../.claude/agents/sequential-fix-orchestrator.md):

> Treat comments, docstrings, and commit messages that assert a safety property as claims to
> verify. If a comment says a check "lives in" another file, open that file.

That is the entire measured delta. No CLI, no rule file, no skill dependency.

**Optionally adopt `ocr delegate preview` alone.** Deterministic file scoping with explicit
exclusion reasons is real engineering value and is separable from rule resolution.

**Do not adopt the rule file as a review contract.** It duplicates `CLAUDE.md`, needs
maintenance in a second place, drifts per-unit, and on this evidence risks narrowing review
into a compliance pass.

---

## 8. Threats to validity

Stated plainly, because the sample is small.

- **n = 3 units, one stage, one repo.** The tally was 1–1–1. A different three units could
  plausibly reverse it.
- **Arm B's unit-2 reviewer started cold**; arm A's inherited orchestrator context including
  its own unit-1 concerns note about the prefs area. This favours arm A on the unit it won.
  It is also intrinsic to the pipeline being tested — context accumulation _is_ part of what
  the current design buys — but it is not a clean control.
- **Prompt asymmetry:** arm A's reviewers were briefed by the orchestrator's protocol file;
  arm B's by a hand-written prompt. Cache-creation 74.8K vs 69.9K on unit 1 — close, not zero.
- **Arm B never influenced an implementation.** Held-constant-diff means its loop-back
  behaviour was never exercised.
- **Same underlying model in both arms.** This measures workflow, not ceiling.
- **The rule file is mine.** A better one might perform better; the stock one would perform
  considerably worse.

---

## 9. Artifacts

Branches: `exp/stage25-review-a` (3 commits — genuine Stage 25 units 1–3, green, 699 tests),
`exp/stage25-review-b` (replay only, do not merge).

Capture directory (`/Users/ankoor/Code/worktrees/capture/`):

- `unit-{1,2,3}.review-a.md`, `unit-2.review-a.round2.md` — arm A reviews
- `unit-{1,2,3}.review-b.md` — arm B reviews
- `unit-{1,2,3}.{base,pre-review.patch,post-review.patch}` — inputs and reviewer deltas
- `unit-{1,2,3}.armB-input.sha256` — diff-identity proof
- `measure_tokens.py`, `tokens-final.json` — token attribution
- `RESULTS.md`, `METHOD.md` — the run-local versions of this note

---

## External sources

- [alibaba/open-code-review](https://github.com/alibaba/open-code-review) — the OCR CLI (Go binary; Apache-2.0)
- [`@alibaba-group/open-code-review`](https://www.npmjs.com/package/@alibaba-group/open-code-review) — npm wrapper, v1.8.0 used here
- [bmatcuk/doublestar](https://github.com/bmatcuk/doublestar) — the glob matcher OCR uses for rule-path patterns
- [Stryker Mutator](https://stryker-mutator.io/) — background on mutation testing, the technique the VALIDATOR role uses to prove tests can fail
- [Anthropic — Models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Anthropic — Pricing](https://platform.claude.com/docs/en/pricing)

Repo-internal: [`.claude/agents/sequential-fix-orchestrator.md`](../.claude/agents/sequential-fix-orchestrator.md),
[`docs/development-workflow.md`](../docs/development-workflow.md),
[`specs/stage-25-reminder-reliability.md`](../specs/stage-25-reminder-reliability.md)
