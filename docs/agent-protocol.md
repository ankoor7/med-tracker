# Agent run protocol

Standing detail for every role agent in the Implement → Validate → Review loop.
Read this **once, first**; the spawn prompt covers only what is specific to your unit.

This file is durable and committed (specs: `specs/agent/agent-stage-3-state-ratchet.md`,
`agent-stage-4-ephemeral-orchestrator.md`). It used to be rewritten into a scratch
path every session, which meant it vanished at session boundaries.

## 0. Bootstrap first

```
./scripts/agent-bootstrap.sh [unit-id]
```

This prints, in a fixed order: run state and the next action, recent commits, the
working tree, environment liveness, **failed approaches you must not retry**, and
recent learnings. Do not rediscover any of it by hand — that is what this replaces.

## 1. Environment

| Need                          | Command                                    |
| ----------------------------- | ------------------------------------------ |
| Dev server                    | `pnpm dev` (http://localhost:5173)         |
| Local backend                 | `pnpm local:up` then `pnpm local:env`      |
| Reset DB                      | `pnpm local:reset`                         |
| Full check (green-build gate) | `pnpm typecheck && pnpm lint && pnpm test` |
| Agent tooling tests           | `pnpm agent:test`                          |

Dev account: `dev@steadydose.local` / `DevPassw0rd!`.

Gotchas that cost real time: the pre-commit hook exceeds a 2-minute foreground
timeout — commit with `run_in_background: true`; write commit messages to a file and
use `git commit -F <file>` (apostrophes break heredocs); use `git --no-pager diff`.

## 2. The three roles

**IMPLEMENTER** — implements exactly the unit, not the whole spec and not adjacent
improvements. Respects the architecture boundaries in `CLAUDE.md`. Writes tests
covering the acceptance criteria and the tricky cases. Ends green on the full check.
**Audit gate:** if the unit's premise is unsound, STOP and report — do not paper over it.

**VALIDATOR** — drives the real app the way a user would; never fakes an outcome by
reaching into internal state. Verifies each acceptance criterion live. Then audits the
tests for honesty (tautologies, assertions that would pass against the old code,
mocking so heavy the real logic never runs) and **proves it by mutation**: revert the
fix, confirm the specific new tests fail, restore byte-identical. Says plainly what it
could not verify live.

**REVIEWER** — reads the whole diff for correctness, fit, boundaries, and dead or
duplicated code. Owns the commit gate. **Chases claims made in the code**, not just in
the report: a comment asserting "handled in X" is a claim to verify, and a false
comment is a defect in its own right.

## 3. The test ratchet (FR-A3.6) — non-negotiable

- Tests may be **added or strengthened**. They are **never deleted or weakened to get
  green**. Removing a test to pass is the one shortcut that silently destroys
  functionality, so it is prohibited outright rather than discouraged.
- Any test deletion or loosened assertion in a diff is a **reviewer-must-justify**
  item: the reviewer states why it was correct, in the report, or sends it back.
- Same rule for acceptance criteria: a unit passes by satisfying its criteria, never by
  editing them. The ratchet enforces this mechanically (`pnpm agent:ratchet validate`).

## 4. Recording what happened

Use the ratchet CLI; do not hand-edit `.agent/`.

```
pnpm agent:ratchet record-role <unit> <role> --outcome green|bounced|stopped-at-gate|hung|no-outcome --note "…"
pnpm agent:ratchet failed --unit <unit> --role <role> --approach "…" --why "…" --do-not-retry "…"
pnpm agent:ratchet learn --unit <unit> --role <role> --kind strength|weakness|bounce|doctrine-gap|doctrine-fired \
  --evidence "file:line, a quoted directive, a spec ref, or a sha" --action "what to repeat or change" \
  [--rule D-NN]
```

You may write **only** your own `roles_run` entry, plus the failed-approaches and
learnings files. `status` and `committed_sha` belong to the orchestrator: the agent
that did the work never marks the work done.

**Abandoned an approach? Record it before you move on.** A dead end that is not written
down gets re-attempted by the next fresh context, which has no memory of your session.

**A `doctrine-fired` or `doctrine-gap` entry must name its rule** with `--rule D-NN`
from [`agent-doctrine-ledger.md`](agent-doctrine-ledger.md) — the CLI rejects it
otherwise. The end-of-run audit (FR-A5.2) counts those entries to decide which rules
still earn their context cost, and an unnamed rule is invisible to it: a rule that
fired but was recorded anonymously reads as dormant, and dormant rules get pruned.

## 5. Report format

End every report with these sections, in this order:

1. **Outcome** — one of the `--outcome` values above, and why.
2. **Evidence** — the commands run and their real output (the green-build command in
   full), plus for validators: which criteria were exercised live, and how.
3. **Could not verify** — what you could not check and why. If everything was
   verifiable, say so positively. **Silence here is a failure**, and no efficiency
   pressure justifies claiming "verified" for something you could not drive.
4. **Sent back / open** — anything routed to another role, and any decision you could
   not safely make (with your recommendation).
5. **Directive feedback (one line each)** — what in your brief helped, and what was
   missing. This is the raw material for the learnings record; it is required, and it
   is the only place strengths get captured.
6. **Verdict** — the scored rubric below. Validators and reviewers MUST include it;
   implementers may.

## 6. The verdict rubric (FR-A5.5)

End the report with a block in exactly this shape, then run
`pnpm agent:rubric check <report-file>` — it fails on a missing dimension, a bare
score, or a bounce that names no failing dimension.

```
## Verdict

- correctness: pass — every AC exercised live; the "validated in sync.ts" comment checked out
- test-honesty: fail — reverting the fix left the three new tests green
- fit: pass — logic in src/core/, no store import
- ux-clarity: n/a — no UI in this unit
- bounce: yes (test-honesty)
```

Anchors, so a score means the same thing across runs and roles:

| dimension      | asks                                                              | pass                                                                                                          | fail                                                                                                                                            |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `correctness`  | Does it do what the unit says, for the reasons it claims?         | Every acceptance criterion exercised live and observed to hold; claims made in comments opened and confirmed. | A comment asserts "validated upstream" and the named file contains no such validation — a false claim is a defect even where the code is right. |
| `test-honesty` | Can the new tests actually fail, and do they test the real logic? | The fix was reverted, the named new tests failed, and the revert was restored byte-identical.                 | Tests assert a ratio rather than the value, or mock so heavily the changed code never runs.                                                     |
| `fit`          | Does it belong here — boundaries, duplication, scope?             | Domain logic in `src/core/` with no store or UI import; reused the existing helper.                           | The unit also refactored an adjacent screen, so the fix cannot be separated from the improvement.                                               |
| `ux-clarity`   | Would a person understand the screen?                             | Drove the flow as a user; the result read unambiguously.                                                      | Every test passed and the label still says "Adj." — green checks were never the bar for a UX fix.                                               |

`n/a` is legitimate (a core-only unit has no UX to score) but needs its reason on
the line. **A scored verdict never replaces §5.3:** all-pass with an empty
"Could not verify" section is rejected. Comparability is worth having; it is not
worth having at the price of an honest report.

## 7. Stop conditions

Stop and report rather than guessing when: the unit's premise is unsound; a decision
would change _what gets built_; a gate fails for reasons outside your unit; or the same
anomaly appears for the third time. Stopping with a clear explanation is a good outcome,
not a failure — it is cheaper than a confident wrong fix.
