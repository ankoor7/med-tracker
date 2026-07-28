---
title: 'Agent orchestration efficiency — interruptions, dropped subagents, and stalls'
date: 2026-07-28
tags: [agents, orchestration, reliability, interruptions, subagents, efficiency]
status: complete
---

# Agent Orchestration Efficiency — Interruptions, Dropped Subagents, and Stalls

_Failure modes observed across an 11.5-hour, 22-subagent `sequential-fix-orchestrator` run.
Companion notes: [[04-agent-review-stage-ab-test]], [[05-agent-token-economics]]._

---

## TL;DR

- **~50% of wall-clock was rate-limit downtime** (291 of 577 minutes), caused entirely by
  running two agent arms in parallel against one budget. Serialising cost nothing but time
  already being lost.
- **Every interruption is a cache-write loss, not a work loss.** An agent killed mid-flight
  has paid the 1.25× cache-write premium and recovered none of it. One casualty here wrote
  27,349 tokens and read back **zero**.
- **The most expensive single failure was a duplicated subagent** — 3.15M tokens ($0.85),
  more than four full review passes. The orchestrator believed a validator hadn't run when
  its transcript already existed on disk.
- **Write state to disk at every handoff.** Four resumes cost zero rework because each
  rebuilt from capture files rather than transcript. This is the single highest-leverage
  reliability practice observed.
- **Stalling, not runaway, was the observed failure.** The orchestrator stopped twice to ask
  "shall I continue?" — decisions its own doctrine says are its to make. I did **not** observe
  a subagent burning tokens after completing its work; that mode is discussed below as a risk
  with detection guidance, not as a measured finding.

---

## 1. The run, and what went wrong in it

| Time        | Event                                                                       | Class            |
| ----------- | --------------------------------------------------------------------------- | ---------------- |
| 11:07       | Orchestrator starts unit 1                                                  | —                |
| 11:23–11:54 | Unit 1 validator runs 31 min, 62 tools                                      | —                |
| ~12:24      | Orchestrator stops: _"What would you like me to change before I continue?"_ | **stall**        |
| 12:35–12:44 | **Second** unit 1 validator spawned — first one's work redone               | **duplicate**    |
| 13:41       | Session rate limit; two reviewers killed mid-flight                         | **interruption** |
| 14:46       | Limit resets, work resumes                                                  | —                |
| ~15:2x      | Connection closed mid-response; orchestrator dropped                        | **interruption** |
| 15:55       | Resumed; round-2 review proceeds                                            | —                |
| 16:36       | Session rate limit again; two more reviewers killed                         | **interruption** |
| 20:22       | Limit resets (3h46m later), work resumes                                    | —                |
| 20:44       | Final unit committed                                                        | —                |

**Four resumes. Two stalls. One duplicate spawn. Four agents killed mid-flight.**

Wall-clock span: 577 minutes. Rate-limit downtime: ~291 minutes (13:41–14:46 and
16:36–20:22). **50.4% of elapsed time was waiting on a budget reset.**

---

## 2. Interruptions

### 2.1 The cost is the cache write, not the lost work

The intuition that an interrupted agent "loses its progress" understates the problem. In the
economics of [[05-agent-token-economics]], an agent's first turns are dominated by **cache
writes** at 1.25× input rate. Reads at 0.1× only start paying off later.

An agent killed early has paid the premium and amortised none of it:

| Killed run              | Cache write | Cache read | Amortised?        |
| ----------------------- | ----------: | ---------: | ----------------- |
| Unit 2 reviewer (arm B) |      27,349 |      **0** | none — died 4s in |
| Unit 2 reviewer (arm A) |      56,734 |    192,701 | 1:3               |
| Unit 3 reviewer (arm B) |      47,782 |    462,842 | 1:10              |
| Unit 3 reviewer (arm A) |      57,775 |    381,069 | 1:7               |

Compare a healthy completed run at 1:11 to 1:51. **Interrupted agents systematically show the
worst write:read ratios in the dataset**, because the ratio improves monotonically with run
length.

Total: 1,240,364 tokens / $0.76 across four kills.

### 2.2 Rate limits are self-inflicted at the concurrency layer

Both rate-limit events occurred while **two arms plus their nested subagents** drew on the
same budget concurrently. The validators are the heavy role (44% of all tokens), so two
pipelines each running a validator is the worst possible overlap.

After serialising, no further limits were hit.

**Practice:** treat concurrent agent pipelines as sharing one budget, and serialise anything
whose handoff points are files on disk. Parallelism buys wall-clock only when it does not
trigger the limit that costs hours.

### 2.3 Recovery is free if state lives on disk

None of the four resumes cost rework. Each was recovered by reading capture files:

```sh
git rev-parse HEAD              > capture/unit-N.base
git add -A
git --no-pager diff HEAD        > capture/unit-N.pre-review.patch
git status --porcelain          > capture/unit-N.files
```

On resume, the message to the orchestrator was a _state assertion_, not a request to
re-derive:

> "Commits: `a8def80` (Unit 1), `3fa7a29` (Unit 2). `unit-3.base` and
> `unit-3.pre-review.patch` are captured. Pick up at spawning the Unit 3 REVIEWER."

This is the orchestrator doctrine's own advice, and it held up:

> **At a session boundary, write a handoff** that leads with any uncommitted work, then the
> committed units, then what remains. The next session cannot see your transcript — only what
> you wrote down and committed.

**One caution learned mid-run:** on resume, explicitly forbid re-running capture steps. A
second `git add -A && git diff` would have produced a fresh patch, and if the tree had drifted
at all, the held-constant-diff comparison in [[04-agent-review-stage-ab-test]] would have been
silently invalidated. Idempotent-looking steps are not always idempotent.

---

## 3. Dropped subagents

### 3.1 The duplicate validator — most expensive single failure

The orchestrator reported _"Stopped before the Unit 1 validator ran."_ A `Unit 1 validator`
transcript already existed on disk, showing 31 minutes and 62 tool calls including mutation
testing. A replacement was spawned and redid the work.

**Cost: 3,146,748 tokens ($0.85)** — more than all four arm-A review passes combined ($2.09
for four passes, so ~1.6 passes' worth).

The doctrine covers this exactly:

> **A subagent whose spawn was rejected mid-turn may still have left work on disk.** Always
> check the working tree after any interruption before spawning a replacement — you may be
> building on top of, or duplicating, real work.

It did not fire. The rule exists; nothing enforces it.

### 3.2 Why an agent's own account is unreliable here

The orchestrator was not lying — from inside its context, the spawn had been rejected and no
result had returned. The transcript on disk was invisible to it.

**A subagent's existence is filesystem state, not conversational state.** After any
interruption, the check is mechanical:

```sh
ls ~/.claude/projects/<slug>/<session-id>/subagents/*.meta.json
git status --porcelain          # did it leave edits?
git stash list                  # did it leave a mutation-test stash?
```

This also matters for correctness, not just cost: the VALIDATOR role mutation-tests by
reverting a fix, confirming tests fail, then restoring. **An interrupted validator can leave
an unrestored mutation on disk.** A replacement spawned on top of that is building on
corrupted state.

### 3.3 Resumed agents distort timing data

The unit-2 implementer's transcript window spans 12:56–15:08 (2h12m) — overlapping the
validator and both reviewers. It was not running that whole time; it was **resumed** for the
bounce, and the transcript window covers first-to-last message across both invocations.

Relevant when reading token data: a wide window is not evidence of a runaway. Cross-check
tool-call counts and per-message timestamps before concluding an agent overran.

---

## 4. Stalls — the failure actually observed

The orchestrator stopped twice mid-run to ask permission to proceed:

> "Nothing has been committed, and no capture files have been written yet. What would you like
> me to change before I continue?"

Its own agent file draws the line clearly:

> **Yours:** routine engineering calls with a defensible default — naming, test structure,
> which helper to extract, how to sequence pieces. Make them, state them, move on.
> **The user's:** anything that changes _what gets built_ or is hard to reverse.

"Shall I continue to the next stage?" is neither. Nothing in the file distinguishes a **scope
decision** (the user's) from a **progress checkpoint** (nobody's).

**Cost profile:** a stall is cheap in tokens but expensive in latency — it converts an
autonomous run into a turn-taking one. Over three units it added two round-trips that
contributed nothing.

**Fix — one paragraph in the agent file:**

> You do not need approval between stages, between units, or before committing. Only stop for
> decisions that change what gets built or are hard to reverse. "Should I proceed?" is not
> such a decision — if you are mid-pipeline with a green build, continue.

This was applied by hand on the first resume, and the orchestrator ran the remaining units
without stalling.

---

## 5. Runaway subagents — risk, not observation

The user raised "subagents not stopping and continuing to use tokens" as a suspected drain.

**I did not observe this in this run.** No agent continued consuming tokens after producing
its deliverable. The observed failure was the opposite — premature stopping. Stating this
plainly because the distinction changes what is worth building.

That said, the mechanism is real and worth guarding, and this run surfaced its two
preconditions:

**1. Background-by-default execution.** Subagents run detached and report via notification. An
agent that never reaches a stop condition is not obviously visible — there is no blocking call
to watch time out. Wall-clock windows here reached 2h12m legitimately (via resume), so
"it's been running a long time" is not by itself a signal.

**2. No token ceiling per role.** Nothing in the current design caps a single subagent's
spend. The unit-2 validator legitimately consumed 9.88M tokens; a malfunctioning one could
consume the same with nothing to show, and the difference is only visible after the fact.

### Detection

The transcript directory makes this measurable _during_ a run, not just after:

```sh
# Live spend for a running agent
python3 measure_tokens.py ~/.claude/projects/<slug>/<session-id> | sort -k3 -h

# Signature of a healthy run:   high tool count, output tokens roughly tracking tool calls
# Signature of a spinning run:  climbing cache_read, flat tool count, near-zero output
```

The last pattern is the tell: **an agent re-reading its own context without acting.** Cache
reads climb, tool calls plateau, output stays flat.

### Guards worth adding

- **Explicit stop conditions in every spawn prompt.** The doctrine already recommends this
  (_"if you hit a decision you cannot make safely, STOP and report with your recommendation
  rather than guessing"_) — extend it with a work ceiling: _"if you have not reached a green
  build after N attempts, stop and report what is blocking."_
- **Task budgets**, when building on the API directly — a token ceiling the model is _aware_
  of, so it paces itself and wraps up gracefully rather than being cut off. Distinct from
  `max_tokens`, which is an enforced cap the model cannot see. See external sources.
- **A periodic spend check** on long runs, using the recipe above.

---

## 6. Ranked recommendations

| #   | Change                                                                        | Measured basis                                  | Effort           |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------- | ---------------- |
| 1   | **Check the subagent directory + working tree before spawning a replacement** | 3.15M tokens ($0.85) lost to one duplicate      | 3 lines          |
| 2   | **Serialise concurrent agent pipelines**                                      | 291 min (50% of wall-clock) lost to rate limits | scheduling       |
| 3   | **Capture handoff state to disk at every stage boundary**                     | 4 resumes, zero rework                          | already doctrine |
| 4   | **Distinguish scope decisions from progress checkpoints in the agent file**   | 2 stalls                                        | 1 paragraph      |
| 5   | **Forbid re-running capture steps on resume**                                 | near-miss: would have invalidated the A/B       | 1 sentence       |
| 6   | **Add a work ceiling to spawn prompts**                                       | preventive — not observed here                  | 1 sentence       |

Items 1 and 2 together account for ~4.4M tokens and ~5 hours. Neither requires new tooling.

---

## 7. The broader pattern

Every failure in this run was covered by an existing rule in
[`.claude/agents/sequential-fix-orchestrator.md`](../.claude/agents/sequential-fix-orchestrator.md).
The duplicate spawn, the handoff discipline, the decision boundary — all documented, all
correct, and the duplicate spawn happened anyway.

**Prose doctrine degrades under interruption.** The rules an agent follows reliably in a clean
run are exactly the ones it drops after an API error, because recovering context competes with
recalling procedure. The rules that survived here were the ones with **filesystem artifacts** —
the capture protocol worked across four resumes precisely because it did not depend on the
agent remembering anything.

Where a rule matters and is cheap to mechanise, mechanise it. A pre-spawn `ls` of the subagent
directory is worth more than a paragraph telling the agent to remember to look.

---

## External sources

- [Anthropic — Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — why interrupted agents lose the write premium; TTL behaviour
- [Anthropic — Rate limits](https://platform.claude.com/docs/en/api/rate-limits) — limit classes and `retry-after` semantics
- [Anthropic — Errors](https://platform.claude.com/docs/en/api/errors) — 429 / 5xx handling and retry guidance
- [Anthropic — Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) — pruning stale tool results from a long-running agent
- [Anthropic — Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction) — server-side summarisation as context approaches the window
- [Anthropic — Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/skills.md) — progressive disclosure as a context-control mechanism
- Task budgets — a model-visible token ceiling for agentic loops, distinct from `max_tokens`; see the Anthropic migration/model docs for the current beta header and `output_config.task_budget` shape

Repo-internal: [`.claude/agents/sequential-fix-orchestrator.md`](../.claude/agents/sequential-fix-orchestrator.md),
[`docs/development-workflow.md`](../docs/development-workflow.md), `capture/measure_tokens.py`
