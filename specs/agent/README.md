# Agent specs

Specs in this folder describe **the agent setup itself** — the orchestration method, the
role definitions, and the tooling that supports them. They are not product specs: nothing
here ships in the app.

## Why separate

`specs/stage-NN-*.md` are product stages, numbered on the roadmap in
`specs/03-implementation-plan.md`. Agent-infrastructure work has its own dependency chain and
its own definition of done (usually a measured cost or reliability delta, not a user-visible
feature), so it lives here with its own numbering.

## Conventions

- Files: `agent-stage-N-<slug>.md`
- Requirements: `FR-AN.x` — deliberately distinct from product `FR-NN.x` so the two can never
  collide in a directive.
- Acceptance criteria: `AC-AN.n`
- Same header table and section structure as product specs, so the
  `sequential-fix-orchestrator` can consume them unchanged.

## Trial specs

Most specs here are **trials**, not builds. An agent-method change is only worth keeping if
it is measurably better, so each carries a **baseline**, a **target**, and an explicit
**revert condition**. A trial that misses its target and gets reverted is a successful trial —
record the finding and move on.

## Measurement

Baselines come from Claude Code's own subagent transcripts:

```
~/.claude/projects/<project-slug>/<session-id>/subagents/agent-<id>.{jsonl,meta.json}
```

`meta.json` gives `agentType` / `description` / `spawnDepth` (nested role agents appear at
depth 2); each assistant message's `usage` block gives the four token classes. The attribution
script is `scripts/measure-agent-tokens.py` (see `FR-A1.6`).

**Cost-weight the results.** Raw token counts hide the economics: a cache write costs 12.5× a
cache read, so 7.3% of tokens can carry ~48% of cost. Rates in
[Anthropic pricing](https://platform.claude.com/docs/en/pricing).

## Index

| Spec | Subject | Status |
| --- | --- | --- |
| [`trial-protocol.md`](trial-protocol.md) | Shared harness: subject, controls, isolation, sequencing | Ready |
| [`agent-stage-2-validator-efficiency.md`](agent-stage-2-validator-efficiency.md) | Validator cost and interaction realism | Ready — **trial runs first** |
| [`agent-stage-1-orchestrator-efficiency.md`](agent-stage-1-orchestrator-efficiency.md) | Orchestrator cost, cache behaviour, learnings capture | **Built, trial pending** — runs second |
| [`agent-stage-3-state-ratchet.md`](agent-stage-3-state-ratchet.md) | Externalized run state: units ratchet, failed approaches, bootstrap, two-sided learnings | **Tooling built + Tier 0 green**, Tier 2 pending |
| [`agent-stage-4-ephemeral-orchestrator.md`](agent-stage-4-ephemeral-orchestrator.md) | Outer loop, one orchestrator per unit, mechanical ceilings, run report | **Loop built + Tier 0 green**, Tier 1/3 pending |
| [`agent-stage-5-self-tuning-doctrine.md`](agent-stage-5-self-tuning-doctrine.md) | Doctrine ledger, per-run audit, pruning, empirical model-role fit | **Tooling built + ledger back-filled**; live audit and model-role A/Bs pending |

Stages 3–5 come from the cross-company long-running-agent patterns (Anthropic's harness
work, Cursor's scaling post, the Ralph loop): externalise state, make the brain ephemeral,
keep a dumb deterministic loop above it. A3 supersedes nothing; **A4 supersedes FR-A1.1 and
FR-A1.2**, since removing the resident orchestrator dissolves the problems those two
disciplined. A4's revert condition keeps the resident path available until a trial run
clears AC-A4.1/AC-A4.6.

Their tooling is testable without spending tokens and already is: `pnpm agent:test` runs the
Tier-0 suite over the ratchet, bootstrap, preflight, outer loop, run report, doctrine ledger,
and rubric — every loop mechanic driven by a stub agent
(`scripts/agent/__tests__/stub-agent.sh`) so a trial run can only fail on defect parity and
directive quality, never on a loop bug. A5's audit is additionally replayed against a corpus
of the 2026-07-28 baseline's known incidents
(`scripts/agent/__tests__/fixtures/baseline-learnings.jsonl`), because an audit that cannot
find known patterns in recorded data will not find unknown ones live.

`agent-stage-1` is **built but unmeasured**: its FRs are landed (agent-file changes,
`scripts/measure-agent-tokens.py`, `scripts/agent-preflight.sh`, `docs/agent-learnings.md`)
because the measurement harness is a prerequisite for measuring either stage. Its acceptance
criteria still need a trial run, and that run comes after A2's. See `trial-protocol.md` §5 for
why the A2 worktree must not inherit the A1 agent-file changes.

Both trials use the **same subject: Stage 25 units 1–3**, rebuilt from `a3e5ae3`. Read
[`trial-protocol.md`](trial-protocol.md) before starting either — it carries the controls that
make the two runs comparable, and the contamination rules that keep the measurement honest.

Note the run order: A2 before A1. The numbering reflects subject area, not sequence.

## Background

Measured findings that motivated these specs are written up in:

- `research/04-agent-review-stage-ab-test.md` — review-stage A/B
- `research/05-agent-token-economics.md` — where the cost actually goes
- `research/06-agent-orchestration-efficiency.md` — interruptions and dropped subagents
