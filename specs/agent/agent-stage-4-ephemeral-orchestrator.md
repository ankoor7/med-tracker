# Agent Stage 4 Spec — Ephemeral Orchestrator (outer loop, fresh context per unit)

| | |
| --- | --- |
| **Depends on** | `agent-stage-3-state-ratchet.md` (hard — the state layer is all an ephemeral orchestrator has) |
| **Implements** | FR-A4.1 … FR-A4.7 |
| **Milestone** | Agent-method trial |
| **Status** | Loop built 2026-07-31 (`scripts/agent-run.sh`, `scripts/agent/run-report.mjs`); Tier-0 stub-harness tests green (`pnpm agent:test`); Tier-1 replay + Tier-3 smoke pending |
| **Supersedes** | FR-A1.1 (per-unit lifecycle) and FR-A1.2 (non-blocking waits + liveness exception) — see §1 |
| **Sources** | Ralph loop (Huntley); Anthropic *Effective harnesses* (fresh session per feature); Anthropic *Managed agents* (stateless harness, session-as-log); Cursor *Scaling agents* (judge decides continuation between cycles) |

## 1. Objective

Stage A1 diagnosed the orchestrator correctly — 48.6% of run cost, cache write:read 1:4,
because a long-lived context re-primes across every subagent wait, growth, and resume —
but treats the symptoms: FR-A1.1 has it write handoffs while staying alive, FR-A1.2
legislates how it may behave during 30-minute waits, complete with a carefully-bounded
liveness exception justified by a 409-minute hang.

Every published harness that works at this timescale removes the problem instead:
**there is no resident orchestrator.** Ralph's orchestrator is
`while :; do cat PROMPT.md | claude; done` — a bash loop with no context to re-prime.
Anthropic's coding harness spawns a *fresh* agent per feature that cold-starts from the
feature list, progress file, and git log; "context reset strategy: full session teardown
and reconstruction from structured handoff files." Their managed-agents platform makes
the harness stateless by construction — it can crash and a new one resumes from the
event log with nothing lost. Cursor's judge sits *between* work cycles, "enabling fresh
starts," rather than inside them.

Applied here: a deterministic **outer loop** (a script, not a model) spawns one
**ephemeral orchestrator per unit**. The orchestrator cold-starts from the Stage A3
state files, runs one unit's Implement → Validate → Review cycle, commits, updates the
ratchet, and **exits**. The structural consequences, in order of value:

1. **The wait problem vanishes.** A process that holds no billable context can block on
   a 31-minute validator for free. No non-blocking doctrine, no cache-TTL reasoning.
2. **The hang problem moves to the right layer.** The outer loop enforces a wall-clock
   ceiling mechanically and kills/flags on breach. The 409-minute vigil becomes a
   `timeout(1)` invocation, not a judgement call a model must remember to make once per
   interval.
3. **Resume becomes re-run.** An interrupted run resumes by running the loop again;
   idempotency comes from the ratchet (AC-A3.1), not from four expensive re-primes of
   an 11.5-hour context.
4. **Context is bounded by construction**, not by discipline. FR-A1.3's "delegate
   reading" rules stay (they bound the per-unit peak); this stage bounds the lifetime.

What is deliberately kept from the current design: the three personas, send-work-back,
one-unit-one-commit, sharp directives, and the orchestrator's judgement *within* a unit.
The unit is the atom of orchestrator judgement; the loop above it needs none — which is
exactly why it can be a script.

## 2. Scope

**In:**
- The outer-loop runner (script) with per-spawn wall-clock ceiling and run event log.
- The ephemeral orchestrator lifecycle: cold-start → one unit → ratchet update → exit.
- Bounce handling within one lifetime (a bounced unit re-enters the same orchestrator's
  cycle — bounces are intra-unit, so they need no cross-lifetime memory).
- Escalation paths: what the loop does on ceiling breach, on `bounce_count` exceeding a
  threshold, and on a unit needing a user decision.

**Out:** the state files themselves (Stage A3); role-internal efficiency (Stage A2);
replacing intra-unit judgement with a script (the loop sequences units; it decides
nothing about their content).

## 3. Prerequisites

- Stage A3 accepted — specifically AC-A3.1 (zero-transcript resume), which is the exact
  capability each fresh orchestrator exercises at every unit boundary.
- Trial subject and controls per [`trial-protocol.md`](trial-protocol.md); same
  isolation rules.
- A re-measured baseline on the same units (§8 of `agent-stage-1-orchestrator-efficiency.md`).

## 4. Functional requirements

- **FR-A4.1 — Deterministic outer loop.** `scripts/agent-run.sh` (or equivalent): while
  `units.json` has non-`committed` units and no stop condition, spawn a fresh
  orchestrator with a fixed prompt ("bootstrap, take the next eligible unit, run the
  cycle, commit, update the ratchet, exit"). The loop is code — it MUST NOT require a
  model to decide *whether* to continue, only the ratchet's state.
- **FR-A4.2 — One unit per orchestrator lifetime.** The orchestrator exits after
  committing its unit (or after recording why it could not). Exit is mandatory even
  when the next unit is obvious — the fresh spawn's cold-start cost is bounded by
  AC-A3.4 and is the price of a context that never exceeds one unit. This is Anthropic's
  single-feature-per-session constraint and Ralph's one-task-per-loop, verbatim.
  **Learnings before exit:** appending the unit's FR-A3.7 entries (strengths and
  weaknesses, structured) is a mandatory exit step, enforced by the loop — an
  orchestrator that exits without them is treated as a ceiling breach, not a success.
  In the resident design a missed learning survived in the transcript; here the context
  is destroyed at exit, so an unwritten learning is unrecoverable. Exit is the only
  moment this observer exists.
- **FR-A4.3 — Mechanical ceilings.** The loop enforces a wall-clock ceiling per
  orchestrator spawn (start: 90 min — three baseline role agents plus margin). On breach
  it kills the spawn, records the event, verifies tree coherence (build + status), and
  re-spawns; the fresh orchestrator finds the partial state via preflight and resumes or
  salvages per FR-A3.4. The liveness-check doctrine (FR-A1.2's exception, and the
  corresponding section of the agent file) is deleted — a monitor that holds no context
  can watch continuously for free.
- **FR-A4.4 — Run event log.** The loop appends one line per event
  (`spawned | exited | killed | ceiling-breach | user-escalation`, with unit, timestamps,
  exit status) to `.agent/run-log.jsonl` — the managed-agents session-as-event-log,
  scaled to what a shell script can write. This is the debugging record the transcript
  used to be, at zero context cost.
- **FR-A4.5 — Escalation, not stalls.** When a unit needs a user decision, the
  orchestrator records the question (with options and recommendation, per doctrine) in
  the ratchet entry, marks the unit `blocked`, and exits; the loop skips `blocked` units
  and proceeds with eligible ones, stopping only when nothing is eligible. Progress
  checkpoints remain nobody's decision (FR-A1.8): the loop never asks permission to
  continue — continuation is its definition.
- **FR-A4.6 — Bounce budget.** `bounce_count` above a threshold (start: 3) marks the
  unit `blocked` with a synthesis of the bounces rather than looping forever — Ralph's
  operator-intervention lesson made mechanical. The learnings file gets the entry either
  way.
- **FR-A4.7 — End-of-run synthesis (the whole-run observer).** The doctrine's learnings
  premise — "you are the only participant who sees the whole run" — is deleted by this
  stage: no ephemeral orchestrator sees more than one unit, so cross-unit patterns (the
  same directive flaw recurring, the same anomaly re-dismissed, a rule that fired three
  times) have no observer during the run. The loop MUST therefore end every run with a
  bounded synthesis pass: a cheap agent that reads `run-log.jsonl`, `learnings.jsonl`,
  the rubric verdicts (FR-A5.5 once landed), and `units.json` — never the transcripts —
  and appends a **run report** (`.agent/run-report.md` + structured summary block):
  what the loop did well (with the evidence to repeat it), what it did badly (with the
  evidence to fix it), cross-unit patterns no single unit could see, and per-unit
  cost/turn/bounce figures from the measurement harness. This is Cursor's
  judge-between-cycles applied at run scope, and it is the primary artifact the user
  parses after a real test run. **Observability spend is excluded from AC-A4.2's cost
  target** — the synthesis pass and measurement runs are reported separately, so the
  cost goal can never argue for deleting the system's eyes.

## 5. Acceptance criteria

- **AC-A4.1 — Defect-detection parity (gating).** Same bar as AC-A1.4/AC-A2.1: at least
  as many genuine findings per unit as baseline. A cost win that loses findings fails.
- **AC-A4.2 — Orchestrator cost.** Total orchestrator-side cost (all ephemeral spawns
  summed, per-model pricing) falls **≥60%** against the baseline's $20.21 on the same
  units. The target is deliberately above AC-A1.2's ≤25%-share framing because
  eliminating residency should beat disciplining it; if the summed spawns approach the
  resident cost, cold-starts are too expensive and FR-A3.3/AC-A3.4 need work first.
- **AC-A4.3 — Cache ratio.** Each orchestrator spawn individually achieves cache
  write:read ≥1:10 — the short-lived profile every role agent already exhibits (1:11–1:51).
- **AC-A4.4 — Kill-resume works.** Killing the loop at an arbitrary point and re-running
  it completes the stage with zero re-executed role work (AC-A1.7's bar, now demonstrated
  by re-running a script rather than by careful manual resumption).
- **AC-A4.5 — Ceiling fires correctly.** A deliberately-hung spawn (test fixture) is
  killed at the ceiling, the tree is verified coherent, and the successor resumes the
  unit — total loss bounded by one ceiling interval, against 409 minutes at baseline.
- **AC-A4.6 — Directive quality holds.** The bounce rate per unit does not exceed
  baseline (~1 in 3). Rising bounces mean cold orchestrators write worse directives than
  a warm one — the A1 open question ("does a thinner orchestrator write worse
  directives?") answered in the negative, and the revert condition below.
- **AC-A4.7 — Visibility survives the trial (gating).** The trial run produces: a
  complete `run-log.jsonl` (every spawn accounted for), `learnings.jsonl` entries for
  every unit including at least one strength and one weakness class (AC-A3.6's bar),
  and a run report per FR-A4.7 containing at least one cross-unit observation that no
  single unit's entries state. A run whose cost numbers pass but whose observability
  artifacts are missing or vacuous fails this stage — the runs exist to be learned
  from, and an efficiency change that cannot show what it did well and badly cannot be
  iterated on.

## 6. Revert conditions

- **Revert to the resident orchestrator** if AC-A4.1 or AC-A4.6 fails after one
  iteration on the state files: that result means cross-unit context in the
  orchestrator's head was buying directive quality that `units.json` +
  failed-approaches + learnings cannot replace. Record it — it would be a genuinely
  interesting negative result against the industry pattern.
- **Keep the outer loop's ceiling mechanism regardless** (FR-A4.3/FR-A4.4) — it is
  valuable even wrapping a resident orchestrator, and replaces the fragile liveness
  doctrine either way.

## 7. Open questions

- **What is the loop, concretely?** ~~Open~~ **Settled 2026-07-31:** bash
  (`scripts/agent-run.sh`), as leaned. Two implementation notes. There is no `timeout(1)`
  on macOS, so the ceiling is a poll-and-kill loop that kills the *process group* —
  an orchestrator's own role agents must not outlive it — and returns 124 to match
  `timeout(1)`'s convention. And `AGENT_CMD` overrides the spawn, which is what makes the
  whole loop testable for zero tokens. Revisit the SDK runner only if AC-A4.5's salvage
  path proves lossy: a cold successor re-deriving a killed spawn's work is the one thing
  bash cannot do that the SDK can.
- **Who writes the protocol file now?** ~~Open~~ **Settled 2026-07-31:** promoted out of
  scratch entirely into `docs/agent-protocol.md`, committed and versioned. No spawn
  writes it; every spawn reads it (the loop passes it as an appended system prompt). It
  carries the standing detail, the FR-A3.6 test ratchet, the ratchet CLI commands, and
  the report format — including the required directive-feedback line that feeds
  FR-A3.7's strength entries.
- **Model for the ephemeral orchestrator.** The resident one is opus. A one-unit
  orchestrator does less accumulation and might not need it — but directive quality is
  the thing AC-A4.6 guards, so trial opus first and only then try stepping down
  (Stage A5 owns the systematic version of that question).
- **Cross-unit intuition.** ~~Open~~ **Settled 2026-07-30** into FR-A4.7: end-of-run
  synthesis is mandatory, not contingent — visibility from real runs is a stated
  requirement of the trial, not an optimisation to add if entries get shallow. The
  remaining sub-question is *mid-run* pattern detection ("same anomaly, third time"
  noticed at unit 3, not at run end). Cheap option if run reports show it matters: the
  loop passes each spawn the last N learnings entries via bootstrap, which is already
  FR-A3.3's tail mechanism — no resident context needed.

## 8. Test plan

Ordered so the expensive trial only ever fails on the questions that need it
(defect parity, directive quality) — never on loop mechanics a stub could have caught.

**Tier 0 — stub-agent harness, zero tokens.** The outer loop is code; test it with a
**stub agent** — a shell script substituted for the real orchestrator spawn
(`AGENT_CMD` override in `agent-run.sh`) that reads the state files and writes canned
outcomes. Scenarios, each a repo-resident test:

- **Happy path:** stubs mark units committed in sequence; loop terminates when
  `units.json` is exhausted; `run-log.jsonl` accounts for every spawn (FR-A4.1/A4.4).
- **Kill-resume (AC-A4.4):** kill the loop between spawns and mid-spawn; re-run;
  assert zero re-invocation for work the ratchet records.
- **Ceiling breach (AC-A4.5):** a stub that sleeps past a shortened test ceiling;
  assert kill, coherence check, `ceiling-breach` event, successor spawn.
- **Blocked units and bounce budget (FR-A4.5/A4.6):** stubs that mark a unit blocked
  or bounce repeatedly; assert the loop skips, proceeds with eligible units, stops
  only when nothing is eligible, and blocks at `bounce_count` threshold.
- **Learnings-on-exit enforcement (FR-A4.2):** a stub that exits without writing
  FR-A3.7 entries; assert the loop treats it as a breach, not a success.

**Tier 1 — synthesis on replayed data, cents.** FR-A4.7's run report does not need a
new run to be developed: hand-construct `run-log.jsonl` + `learnings.jsonl` from the
**2026-07-28 baseline transcripts** (which contain known cross-unit patterns — the
duplicate validator spawn, the re-dismissed anomaly) and iterate the synthesis agent
against that corpus on a cheap model until it surfaces them. A synthesis pass that
cannot find the known patterns in recorded data will not find unknown ones live.
This corpus also serves FR-A5.2's audit development.

**Tier 2 — covered by Stage A3.** Cold-start correctness of each ephemeral spawn is
A3's fixture matrix; do not re-buy it here.

**Tier 3 — single-unit smoke, then the trial.** One real unit (the cheapest of the
Stage 25 set) end-to-end through the loop before the 3-unit A/B. It exercises
AC-A4.2/A4.3's cost profile and AC-A4.7's artifacts at one-third scale; a surprise
here aborts the trial at a third of the price. Only AC-A4.1 (defect parity) and
AC-A4.6 (bounce rate) inherently require the full trial — by design they are the only
untested claims left when it starts.
