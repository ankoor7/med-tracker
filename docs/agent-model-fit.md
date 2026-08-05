# Agent model-role fit

Which model runs which role, and **why we believe it** (FR-A5.4, spec:
[`specs/agent/agent-stage-5-self-tuning-doctrine.md`](../specs/agent/agent-stage-5-self-tuning-doctrine.md)).

The doctrine's model-selection section used to be an untested prior stated as a
rule — and the 2026-07-28 baseline quietly contradicted it: all three
implementers ran opus while `trial-protocol.md` §4 pins the role model to
sonnet, so any cost delta measured on implementers was confounded
(`docs/agent-learnings.md`, 2026-07-29). This file replaces belief with a table,
and marks every row that is still belief.

Role fit is **empirical and often counterintuitive**. Cursor found their general
model out-planned their coding-tuned one, and that a top-tier model "tends to
stop earlier and take shortcuts" in a worker role. Those are results to
reproduce here, not conclusions to import — an imported prior is still a prior.

## Current assignments

| role                   | model                                             | decided by           | metric                            | numbers | date       |
| ---------------------- | ------------------------------------------------- | -------------------- | --------------------------------- | ------- | ---------- |
| implementer            | mid-tier, top-tier for architecturally hard units | **prior (untested)** | bounce rate                       | —       | 2026-07-25 |
| validator              | mid-tier                                          | **prior (untested)** | defects found + mutations killed  | —       | 2026-07-25 |
| reviewer               | mid-tier                                          | **prior (untested)** | genuine findings per pass         | —       | 2026-07-25 |
| ephemeral orchestrator | top-tier                                          | **prior (untested)** | directive quality via bounce rate | —       | 2026-07-31 |

Cost per unit is reported alongside each measured row when it lands; a row that
wins on its outcome metric but costs multiples of the alternative is a decision,
not a default, and the decision goes in the row.

## Why every row still says `prior`

The A/Bs are deliberately last and gated (spec §8): fitting models to roles whose
shape is still changing measures a configuration about to be deleted. Stage A3
externalised the state and Stage A4 replaced the resident orchestrator with an
ephemeral one — the orchestrator role's _shape_ changed twice in a week. Running
the most expensive experiment in the A-series against that would have bought a
number with a short shelf life.

**Gate:** A3 and A4 green (their trials cleared, or explicitly deferred with the
resident path retired) before the first A/B runs.

## The procedure, once the gate opens

One A/B per role, top-tier vs mid-tier, on the trial-protocol units so the
baseline is free:

1. Hold everything else fixed — same units, same worktree rules, same protocol
   file (`trial-protocol.md` §5's contamination rules apply).
2. Swap one role's model. Run the same units through `scripts/agent-run.sh`.
3. Score on **that role's own outcome metric**, not on cost: implementer →
   bounce rate; validator → defects found and mutations killed; reviewer →
   genuine findings per pass; orchestrator → bounce rate as a proxy for directive
   quality. Rubric verdicts (FR-A5.5) make "genuine finding" comparable
   dimension-by-dimension rather than by re-reading reports.
4. Report cost per unit from `pnpm agent:measure` beside the outcome metric.
5. Write the winner into the row above **with its numbers and the date**, and
   note whether it confirmed or overturned the prior. Both are results;
   overturning one is the more useful.

Re-check a row when the models change. A row whose date is older than the model
it names is a prior again, whatever it says.
