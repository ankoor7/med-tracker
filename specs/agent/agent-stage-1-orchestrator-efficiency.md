# Agent Stage 1 Spec — Orchestrator Efficiency (cache, context, learnings)

| | |
| --- | --- |
| **Depends on** | `.claude/agents/sequential-fix-orchestrator.md`, `docs/development-workflow.md` |
| **Implements** | FR-A1.1 … FR-A1.8 |
| **Milestone** | Agent-method trial |
| **Status** | Ready |

## 1. Objective

The `sequential-fix-orchestrator` works — the Implement → Validate → Review loop caught real
defects that neither live testing nor mutation testing could reach. It is also the **single
most expensive agent in the pipeline**, and for a structural reason rather than a wasteful one.

Measured over one full 3-unit run (22 subagents, 55.5M billed tokens, $21.10):

| | Orchestrator | Typical role agent |
| --- | --- | --- |
| Share of tokens | 19.6% | 5–18% |
| **Share of cost** | **35.4%** | 8–12% |
| **Cache write : read** | **1:4** | **1:11 – 1:51** |
| Cache-write spend | **$5.66** (27% of the whole run) | $0.19–0.51 |

The cause is not verbosity — the orchestrator emitted 8,494 output tokens all run ($0.08).
It is **context re-priming**. A cache write costs 12.5× a read, and the orchestrator pays that
premium repeatedly because:

1. It is long-lived (11.5h) while role agents live 5–30 minutes.
2. It **blocks on subagents that outlive the 5-minute cache TTL** — validators ran 8–31
   minutes each — so the next turn re-writes the prefix instead of reading it.
3. Its context grows monotonically across every unit; each growth invalidates the prefix
   beyond the insertion point.
4. It was resumed four times, each resume re-priming the whole accumulated context.

**This stage trials structural fixes.** It does **not** touch what is working: the three
distinct personas stay, the send-work-back loop stays, and the orchestrator's role as the place
where process is reviewed and learnings are collected is strengthened, not removed.

> Worked example of the waste: two Unit-1 validator transcripts exist. The orchestrator
> reported "the validator hasn't run" while a 31-minute, 62-tool-call transcript sat on disk,
> then spawned a replacement. Cost of that one duplicate: **3.15M tokens ($0.85)** — more than
> all four review passes in the run combined.

## 2. Scope

**In:**
- **Bounded orchestrator context** — a per-unit orchestrator lifecycle with a compact on-disk
  handoff, replacing one monotonically-growing context across the whole stage.
- **Non-blocking coordination** — the orchestrator stops doing turns while a subagent runs, so
  the wait costs nothing rather than costing a cache re-write.
- **Thin orchestrator** — it delegates reading rather than pulling files into its own context.
- **Duplicate-spawn guard** — a mechanical pre-spawn check, not a remembered rule.
- **Learnings capture** — a durable, structured record of what the run taught, surviving the
  context reset that FR-A1.1 introduces.
- **Measurement harness** — an in-repo script so every future run is measurable without
  re-deriving the method.

**Out:** changing the three personas or their division of labour (settled — the combination is
what catches the bugs); replacing the orchestrator with a non-agentic runner; validator-internal
cost (that is `agent-stage-2-validator-efficiency.md`); reviewer changes (settled by the A/B in
`research/04-agent-review-stage-ab-test.md` — keep the current reviewer).

## 3. Prerequisites

- **Trial subject: Stage 25, units 1–3** (FR-25.3 → FR-25.7 → FR-25.4), rebuilt from `a3e5ae3`
  in a fresh worktree. Shared harness, controls, isolation requirements, and sequencing are in
  [`trial-protocol.md`](trial-protocol.md) — read it before the first spawn.
- A measured baseline from at least one full run, per-role, cost-weighted (FR-A1.6). The
  2026-07-28 baseline in §8 was measured on exactly these units from exactly this commit, so
  deltas are a true A/B rather than an approximation.
- **Run order: this stage runs second**, on top of a settled Stage A2. FR-A1.3 (thin
  orchestrator) could plausibly increase validator `Read` volume, so measuring it against an
  already-improved validator is interpretable where measuring both at once is not.
- **Isolation:** role agents MUST NOT be able to read `specs/agent/**` or `research/04–06` —
  those describe the known defects and would invalidate AC-A1.4. See `trial-protocol.md` §3.

## 4. Functional requirements

- **FR-A1.1 — Per-unit orchestrator lifecycle.** The orchestrator's context MUST be bounded to
  one unit. At each unit boundary it writes a compact handoff (committed SHAs, remaining units,
  open decisions, gotchas) and the next unit starts from that file rather than from an
  accumulated transcript. The handoff MUST be sufficient to resume with no transcript access —
  this is already the doctrine's session-boundary rule, applied per unit instead of per session.
- **FR-A1.2 — Non-blocking waits.** While a subagent is running, the orchestrator MUST NOT
  perform turns that re-read its context (no polling, no speculative planning). It either runs
  the subagent in the background and yields until notified, or blocks without turn activity.
  Rationale: a turn taken during a 30-minute wait is a guaranteed cache write.
- **FR-A1.3 — Thin orchestrator.** The orchestrator MUST NOT read source files, diffs, or test
  output into its own context when a subagent can read them and report. Its context should hold
  decisions and state, not evidence. Exception: the spec itself, which it must read to write
  good directives.
- **FR-A1.4 — Mechanical duplicate-spawn guard.** Before spawning any role agent, the
  orchestrator MUST check for an existing transcript for that role+unit and inspect the working
  tree (`git status --porcelain`, `git stash list`). If prior work exists it resumes or salvages
  rather than respawning. This MUST be a command it runs, not a rule it remembers.
- **FR-A1.5 — Structured learnings capture.** Each unit MUST append to a durable learnings file
  (`docs/agent-learnings.md` or equivalent): what bounced and why, which role caught what, any
  directive that produced a bad result, and any doctrine rule that failed to fire. Entries MUST
  be specific enough to act on (a `file:line` or a quoted directive), not "review went well".
  This file is an input to future spec revisions and MUST survive the FR-A1.1 context reset.
- **FR-A1.6 — Measurement harness.** `scripts/measure-agent-tokens.py` MUST attribute tokens
  per subagent from Claude Code transcripts, emit the four token classes plus cost weighting,
  and flag interrupted runs (short transcripts with near-zero output beside a longer sibling).
  A `pnpm agent:measure` script SHOULD wrap it.
- **FR-A1.7 — Resume safety.** A resumed orchestrator MUST NOT re-run capture or snapshot steps
  that already produced artifacts. Idempotent-looking steps are not always idempotent: re-running
  a `git add -A && git diff` capture can silently change a recorded artifact.
- **FR-A1.8 — Progress checkpoints are not user decisions.** The agent file MUST distinguish
  scope decisions (the user's) from progress checkpoints (nobody's). "Shall I continue to the
  next unit?" is not a decision to surface. Two such stalls occurred in the baseline run.

## 5. Acceptance criteria

- **AC-A1.1** — On a ≥3-unit trial stage, orchestrator **cache write:read improves from 1:4 to
  ≥1:10**, measured by FR-A1.6 against a re-measured baseline on the same stage.
- **AC-A1.2** — Orchestrator **cost share falls from 35.4% to ≤20%** of run cost, without
  shifting the spend into role agents: total run cost per unit MUST NOT increase.
- **AC-A1.3** — The three personas are intact and each still owns its stage. Demonstrated by a
  unit that bounces: the reviewer or validator sends work back and the implementer is resumed,
  not restarted.
- **AC-A1.4** — Defect-detection parity: the trial stage's review passes find at least as many
  genuine findings per unit as the baseline. **A cost win that reduces findings is a failure.**
- **AC-A1.5** — Zero duplicate role spawns across the trial, with the FR-A1.4 check visible in
  the transcript before each spawn.
- **AC-A1.6** — A learnings file exists with ≥1 specific, actionable entry per unit, and at
  least one entry demonstrably changed a later directive in the same run.
- **AC-A1.7** — An interrupted run resumes with **zero rework**: no role re-executed work that
  a prior transcript or on-disk artifact already contained.
- **AC-A1.8** — `pnpm agent:measure <session-dir>` produces the per-role cost table on a clean
  checkout, with no manual steps.

## 6. Revert condition

Revert FR-A1.1 (per-unit lifecycle) if **AC-A1.4 fails** — if bounding the orchestrator's
context measurably degrades finding quality, the accumulated context was buying correctness and
the cost is the price of it. Record the result in the learnings file and keep the cheaper
sub-changes (FR-A1.4, A1.6, A1.7, A1.8), which carry no such risk.

## 7. Open questions

- **Per-unit reset vs. compaction.** FR-A1.1 resets context at unit boundaries. The alternative
  is letting it grow and relying on server-side
  [compaction](https://platform.claude.com/docs/en/build-with-claude/compaction) or
  [context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) to
  prune. Reset is cheaper and more predictable but loses cross-unit intuition; compaction keeps
  a summary at the cost of a summarisation pass. **Lean reset**, since FR-A1.5's learnings file
  already carries forward what matters. Confirm during implementation.
- **Cache TTL.** The 5-minute default is what makes long subagent waits expensive. A 1-hour TTL
  costs 2× on write instead of 1.25× and needs ≥3 reads to pay off — which a coordinator
  surviving ten 20-minute waits gets easily. Not directly settable from inside a Claude Code
  agent today; FR-A1.2 is the available mitigation. Revisit if it becomes configurable.
- **Does a thinner orchestrator write worse directives?** FR-A1.3 removes evidence from its
  context. The doctrine is explicit that vague briefs produce vague fixes. Watch AC-A1.4 closely
  — this is the most likely way this stage does harm.

## 8. Baseline (measured 2026-07-28)

One full run, Stage 25 units 1–3, `claude-sonnet-5` roles under an `opus` orchestrator.

| Group | Tokens | % tok | Cost | % cost |
| --- | ---: | ---: | ---: | ---: |
| Orchestrator | 10,866,688 | 19.6% | $7.47 | 35.4% |
| Validators (5 runs) | 24,673,321 | 44.4% | $6.36 | 30.2% |
| Implementers (3) | 7,195,577 | 13.0% | $2.50 | 11.8% |
| Reviewers, kept (4) | 5,994,324 | 10.8% | $2.09 | 9.9% |
| Reviewers, killed (4) | 1,240,364 | 2.2% | $0.76 | 3.6% |
| Setup exploration (2) | 442,300 | 0.8% | $0.23 | 1.1% |
| **Total** | **55,530,329** | | **$21.10** | |

Token class mix: cache read 92.5% / cache write 7.3% / output 0.1% / input 0.1%.
Cost by class: cache read $10.27, **cache write $10.16**, output $0.58, input $0.08.

Identified waste: **4.39M tokens / $1.60 (7.9%)** — one duplicated validator ($0.85) and four
rate-limit-killed runs ($0.76).

Full analysis: `research/05-agent-token-economics.md`.
