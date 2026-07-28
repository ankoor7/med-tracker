# Agent Stage 2 Spec — Validator Efficiency (turns, context, interaction realism)

| | |
| --- | --- |
| **Depends on** | `.claude/agents/sequential-fix-orchestrator.md` (VALIDATOR role), Playwright MCP (`.mcp.json`) |
| **Implements** | FR-A2.1 … FR-A2.8 |
| **Milestone** | Agent-method trial |
| **Status** | Ready |

## 1. Objective

The validator is **the most expensive role in the pipeline** — 44.4% of all tokens across a
measured 3-unit run (24.67M tokens, $6.36), against ~10% for the reviewer. It is also doing
genuinely valuable work: it drives the real app, and it mutation-tests the tests so a test that
cannot fail gets caught.

**The cost is not where intuition puts it.** Profiling every validator transcript:

| Source | Tool calls | Result content | Share |
| --- | ---: | ---: | ---: |
| `Read` | 31 | ~51,000 tok | 36.1% |
| `Bash` | 120 | ~43,800 tok | 31.0% |
| `browser_snapshot` | 22 | ~28,900 tok | 20.4% |
| `browser_find` | 26 | ~8,400 tok | 5.9% |
| everything else | 130 | ~9,100 tok | 6.6% |
| **Total unique content** | **329** | **~141,000 tok** | |

The validators gathered **~141K tokens of unique information** and were billed **24.09M
cache-read tokens** — a **171× re-read factor**. The tools are not expensive. **The cost is
`turns × context`, and context grows monotonically, so every turn re-reads everything before
it.**

Two measurements make this actionable:

**1. Cost is roughly quadratic in turns.**

| Validator | Turns | Cache read | Avg context/turn |
| --- | ---: | ---: | ---: |
| Unit 2 | 97 | 9,680,757 | 99,801 |
| Unit 2 round-2 | 42 | 2,364,245 | 56,291 |

2.31× the turns produced **4.09× the cost**. Halving turn count is worth far more than half.

**2. There is essentially no tool batching.** 329 tool calls across 307 assistant turns ≈
**1.07 tools per turn**. The Messages API permits multiple `tool_use` blocks per assistant
message; the validator is not using them.

This stage trials turn-count and context reduction **without giving up live app driving**. A
validator that stops driving the app and just runs unit tests would be cheap and worthless — the
unit-2 defect it did catch was found by seeding a pre-Stage-25 prefs blob into IndexedDB,
reloading, and confirming on screen.

## 2. Scope

**In:**
- **Turn reduction** via batched independent tool calls and scripted repeat journeys.
- **Context reduction** via snapshot discipline and stale-result hygiene.
- **Mutation-test batching** — keep the proof, cut the cycles.
- **Pass separation** (trial, revertible) — deterministic checks and interactive driving as two
  bounded passes within the one VALIDATOR role.
- Preserving the two behaviours that made the validator valuable: **driving the real app as a
  user would**, and **saying plainly what it could not verify**.

**Out:** replacing live driving with unit tests or mocks; removing mutation testing; merging the
validator into another persona (the three personas are settled); orchestrator-side cost (that is
`agent-stage-1-orchestrator-efficiency.md`).

## 3. Prerequisites

- **Trial subject: Stage 25, units 1–3** (FR-25.3 → FR-25.7 → FR-25.4), rebuilt from `a3e5ae3`
  in a fresh worktree. Shared harness, controls, isolation requirements, and sequencing are in
  [`trial-protocol.md`](trial-protocol.md) — read it before the first spawn.
- **Run order: this stage runs first.** The changes here are internal to the VALIDATOR directive
  and do not alter how other roles are briefed, so their effect is cleanly attributable.
- `scripts/measure-agent-tokens.py` (FR-A1.6) plus a per-tool profiler that reports calls,
  result bytes, turns, and tools-per-turn per agent.
- Playwright MCP available and the dev server reachable, as today.
- **Isolation:** role agents MUST NOT be able to read `specs/agent/**` or `research/04–06`.
  The validator in particular must not know that D2 (the corrupt-JSON `catch`) exists — the
  whole point of AC-A2.1 is whether the *method* surfaces that class of defect. See
  `trial-protocol.md` §3.

## 4. Functional requirements

- **FR-A2.1 — Batch independent tool calls.** The VALIDATOR directive MUST instruct the agent to
  issue independent tool calls in a single turn (multiple `tool_use` blocks) rather than one per
  turn. Genuinely sequential browser steps (click → observe → click) stay sequential; file reads,
  greps, and independent shell checks MUST be batched. Baseline is 1.07 tools/turn.
- **FR-A2.2 — Snapshot discipline.** Prefer targeted queries (`browser_find`, scoped
  `browser_evaluate`) over full `browser_snapshot`. A full snapshot averages ~1,300 tokens and,
  once in context, is re-read on every subsequent turn — a snapshot taken at turn 10 of a
  97-turn run is billed ~87 more times. Full snapshots are permitted when the agent needs to
  orient in an unfamiliar screen; they MUST NOT be the default observation step.
- **FR-A2.3 — Scripted repeat journeys.** Where a user journey is known and repeatable (sign in,
  seed state, navigate to a screen), it MUST be encoded as a Playwright script the validator runs
  in **one** `Bash` turn, reading back a compact result — rather than driven click-by-click.
  Exploratory and first-time paths stay interactive. This converts N browser turns into 1.
- **FR-A2.4 — Batched mutation testing.** Mutations that touch **distinct** code paths MUST be
  applied together, the suite run once, and failures attributed per mutation, then restored from
  a byte-copy with restoration verified. Mutations that touch the same path MUST stay separate,
  because attribution would be ambiguous. The proof obligation is unchanged: every new test must
  be shown able to fail.
- **FR-A2.5 — Stale-context hygiene.** Once a screen has been acted on and its outcome recorded,
  the validator SHOULD NOT re-snapshot it to "confirm" state it already asserted. Where the
  harness supports it, stale tool results SHOULD be cleared
  ([context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)).
- **FR-A2.6 — Two-pass structure (trial).** The VALIDATOR role MAY be realised as two sequential
  bounded passes — (a) **deterministic**: green build, mutation proof, static acceptance checks;
  (b) **interactive**: drive the real app against the acceptance criteria — each starting with a
  fresh, small context and producing one combined report. It remains **one role with one owner
  and one report**; this is a context-bounding change, not a fourth persona.
- **FR-A2.7 — Honest-limits reporting is preserved.** The validator MUST continue to state
  plainly what it could not verify live and why (e.g. no service worker registers under
  `pnpm dev`; OS-level notification persistence is not observable headlessly). Efficiency work
  MUST NOT create pressure to overclaim. A validator that reports "verified" for something it
  could not drive is a worse outcome than any token cost.
- **FR-A2.8 — Per-tool profiling.** The measurement harness MUST report per agent: tool calls by
  name, result bytes by tool, assistant turns, tools-per-turn, and avg context/turn — the metrics
  this spec's acceptance criteria are written against.

## 5. Acceptance criteria

- **AC-A2.1 — Defect-detection parity (gating).** On a re-run of a comparable stage, the
  validator finds **at least as many genuine defects and kills at least as many mutations** as
  baseline. Any cost reduction that loses a defect class fails this stage outright.
- **AC-A2.2 — Live driving preserved.** Each unit's report shows the acceptance criteria
  exercised **through the running app**, not through internal state manipulation standing in for
  a user action. At least one criterion per unit is verified by real interaction.
- **AC-A2.3 — Turn reduction.** Validator assistant turns per unit fall **≥35%** against a
  re-measured baseline on the same stage.
- **AC-A2.4 — Batching.** Tools-per-turn rises from **1.07 to ≥1.8**.
- **AC-A2.5 — Cost.** Validator share of run cost falls from **30.2% to ≤20%**, and validator
  tokens per unit fall **≥40%** (the quadratic relationship means the turn cut should
  over-deliver here; if it does not, context is growing for another reason — investigate before
  accepting).
- **AC-A2.6 — Snapshot ratio.** Full `browser_snapshot` calls per unit fall **≥50%**, with
  targeted queries taking their place — and AC-A2.2 still passes.
- **AC-A2.7 — Mutation proof intact.** Every new test in the trial stage is still demonstrated
  able to fail, and restoration is verified byte-identical after each mutation batch.
- **AC-A2.8 — Honesty intact.** Every report contains an explicit "could not verify live"
  section, or states positively that everything was verifiable. Silence is a failure.

## 6. Revert conditions

- **Revert FR-A2.6 (two-pass)** if the split causes a defect to be missed that a single pass
  would have caught — for example, a behaviour only visible when live-driving evidence and
  mutation evidence sit in the same context.
- **Revert FR-A2.3 (scripted journeys)** if scripted paths start passing while the real UX is
  broken. A script asserts what it was told to assert; an agent driving the app notices that the
  screen is confusing. The doctrine is explicit that a passing suite is not the bar for a UX fix.
- **Revert FR-A2.4 (batched mutations)** on the first ambiguous attribution.

## 7. Open questions

- **Where is the `Read` spend coming from?** `Read` is the single largest content source (36.1%,
  ~51K tokens over 31 calls — ~1,650 tokens each). Some is necessary (the file under test), but
  the validator may be re-reading files the implementer already described in its report.
  Instrument first, then decide whether the fix is a directive change or better handoff content.
- **`Bash` at 120 calls / 31% of content.** Largely test-suite output. Is the full vitest output
  needed in context, or would a tail plus failure extract suffice? A failing run needs detail; a
  passing run arguably needs one line. Trial a compact-on-pass, verbose-on-fail convention.
- **Does batching degrade reasoning?** Batched tool calls mean the agent commits to several
  actions before seeing any result. For independent reads this is free; for anything where the
  first result should inform the second it is harmful. The directive must draw that line
  explicitly, and AC-A2.1 is the guard.
- **Two-pass vs. one pass with context editing.** FR-A2.6 bounds context by splitting; the
  alternative is one pass that prunes stale results in place. Splitting is more predictable and
  easier to measure; pruning keeps continuity. Trial the split first since it is easier to revert.

## 8. Baseline (measured 2026-07-28)

Five validator runs across Stage 25 units 1–3, `claude-sonnet-5`.

| Run | Turns | Tools | Cache read | Avg ctx/turn | Tokens | Cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Unit 1 (interrupted) | 56 | 62 | 3,702,791 | 66,121 | 3,796,968 | $0.99 |
| Unit 1 (replacement) | 46 | 49 | 3,057,113 | 66,458 | 3,146,748 | $0.85 |
| Unit 2 | 97 | 101 | 9,680,757 | 99,801 | 9,879,996 | $2.46 |
| Unit 2 round-2 | 42 | 42 | 2,364,245 | 56,291 | 2,445,303 | $0.70 |
| Unit 3 | 66 | 75 | 5,288,711 | 80,131 | 5,404,306 | $1.36 |
| **Total** | **307** | **329** | **24,093,617** | **78,480** | **24,673,321** | **$6.36** |

Derived: **1.07 tools/turn**; **171× context re-read factor**; cache write:read 1:35 to 1:51
(healthy — the problem is turn count and context size, not caching behaviour).

Note: the two Unit-1 rows are a duplicate spawn, not two units of work — that waste is
addressed by `FR-A1.4`, not here. Baseline comparisons should use the replacement run.

Full analysis: `research/05-agent-token-economics.md`.
