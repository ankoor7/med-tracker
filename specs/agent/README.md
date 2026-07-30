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
