---
title: 'Agent token economics — where the money actually goes'
date: 2026-07-28
tags: [agents, tokens, cost, prompt-caching, efficiency, sequential-fix-orchestrator]
status: complete
---

# Agent Token Economics — Where the Money Actually Goes

_Measured across a full `sequential-fix-orchestrator` run: 22 subagents, 55.5M billed tokens,
$21.10, 11.5 hours wall-clock. Companion notes: [[04-agent-review-stage-ab-test]],
[[06-agent-orchestration-efficiency]]._

---

## TL;DR

- **92.5% of all tokens are cache reads. 7.3% are cache writes — and those writes are ~48% of
  the cost.** Cache writes cost 12.5× reads. Optimising an agent pipeline means minimising
  _re-priming_, not minimising output.
- **The orchestrator is the single most expensive agent** — 19.6% of tokens but **35.4% of
  cost**, because its cache write:read ratio is 1:4 versus 1:11–1:51 for every short-lived
  role agent. Long-lived coordinators pay the cache-write premium repeatedly.
- **Validators are the heaviest role** at 44.4% of tokens. Reviewers are the cheapest at ~10%.
  Optimising the review stage is optimising the wrong thing.
- **Identified waste: 4.39M tokens / $1.60 — 7.9% of the run**, from one duplicated validator
  and four rate-limit-killed reviewer runs. Real, but smaller than the structural cost of
  orchestrator context re-priming.
- Output tokens are **0.1% of volume and 2.7% of cost**. Telling an agent to "be concise"
  saves essentially nothing. Telling it to read less saves everything.

---

## 1. How to measure this at all

Claude Code writes every subagent's transcript to disk:

```
~/.claude/projects/<project-slug>/<session-id>/subagents/agent-<id>.jsonl
~/.claude/projects/<project-slug>/<session-id>/subagents/agent-<id>.meta.json
```

`meta.json` carries `agentType`, `description`, and `spawnDepth`. Critically, **nested
subagents land in the same directory at `spawnDepth: 2`** — so an orchestrator's
implementer/validator/reviewer are individually attributable, not lumped into the parent.

Each assistant message in the `.jsonl` carries a `usage` block:

```json
{
  "input_tokens": 2126,
  "output_tokens": 1050,
  "cache_creation_input_tokens": 74827,
  "cache_read_input_tokens": 821331
}
```

Sum per agent, deduplicating by message id (streaming repeats a message across chunks). The
script used here is `capture/measure_tokens.py`.

> **Do not estimate tokens with `tiktoken`.** It is OpenAI's tokenizer and undercounts Claude
> tokens substantially. Use [`count_tokens`](https://platform.claude.com/docs/en/build-with-claude/token-counting)
> or the transcript `usage` fields, which are ground truth.

---

## 2. The cost model that actually matters

At Claude Sonnet 5 introductory rates (through 2026-08-31):

| Token class              | $/MTok   | Multiple of input |
| ------------------------ | -------- | ----------------- |
| Input (uncached)         | 2.00     | 1×                |
| **Cache write (5m TTL)** | **2.50** | **1.25×**         |
| **Cache read**           | **0.20** | **0.1×**          |
| Output                   | 10.00    | 5×                |

The ratio that governs everything: **a cache write costs 12.5× a cache read.**

Break-even on a 5-minute-TTL cache entry is two requests (1.25× + 0.1× = 1.35× vs 2× uncached).
Anything that forces a _re-write_ of an already-cached prefix — a restart, a model switch, a
tool-set change, an edited system prompt — pays that premium again.

---

## 3. Measured composition

Across all 22 subagents, 55,530,329 billed tokens:

| Class            |     Tokens |  % volume |       Cost |    % cost |
| ---------------- | ---------: | --------: | ---------: | --------: |
| Cache read       | 51,366,759 | **92.5%** |     $10.27 |     48.7% |
| Cache write      |  4,065,880 |      7.3% | **$10.16** | **48.1%** |
| Output           |     58,423 |      0.1% |      $0.58 |      2.7% |
| Input (uncached) |     39,267 |      0.1% |      $0.08 |      0.4% |

**7.3% of the tokens carry 48% of the cost.** This single table reframes agent optimisation:
the lever is not verbosity, it is context re-priming.

---

## 4. Cost by role

| Group                      |         Tokens |     % tok |       Cost |    % cost |
| -------------------------- | -------------: | --------: | ---------: | --------: |
| **Orchestrator** (1 agent) |     10,866,688 |     19.6% |  **$7.47** | **35.4%** |
| **Validators** (5 runs)    |     24,673,321 | **44.4%** |      $6.36 |     30.2% |
| Implementers (3 runs)      |      7,195,577 |     13.0% |      $2.50 |     11.8% |
| Reviewers — arm A kept (4) |      5,994,324 |     10.8% |      $2.09 |      9.9% |
| Reviewers — arm B kept (3) |      5,117,755 |      9.2% |      $1.69 |      8.0% |
| Reviewers — killed (4)     |      1,240,364 |      2.2% |      $0.76 |      3.6% |
| Setup exploration (2)      |        442,300 |      0.8% |      $0.23 |      1.1% |
| **Total**                  | **55,530,329** |           | **$21.10** |           |

Two things fall out immediately.

**The reviewer is the cheapest role in the loop.** A single unit's validator cost 9.88M tokens
— 4.5× its reviewer. The entire A/B experiment in [[04-agent-review-stage-ab-test]] was
measuring a 10% slice.

**The orchestrator's cost share is nearly double its token share.** That is the cache-write
premium, and it has a specific cause.

---

## 5. The orchestrator anomaly

Cache write:read ratio per agent, sorted by cache-write volume:

| Agent              |   Cache write | Cache read |      w:r |   $ write | $ read |
| ------------------ | ------------: | ---------: | -------: | --------: | -----: |
| **Orchestrator**   | **2,264,186** |  8,589,909 |  **1:4** | **$5.66** |  $1.72 |
| Unit 2 implementer |       205,606 |  4,004,509 |     1:19 |     $0.51 |  $0.80 |
| Unit 2 validator   |       190,668 |  9,680,757 | **1:51** |     $0.48 |  $1.94 |
| Unit 3 validator   |       112,788 |  5,288,711 |     1:47 |     $0.28 |  $1.06 |
| Unit 1 validator   |        91,605 |  3,702,791 |     1:40 |     $0.23 |  $0.74 |
| Unit 1 reviewer    |        74,827 |    821,331 |     1:11 |     $0.19 |  $0.16 |

**The orchestrator's $5.66 in cache writes alone is 27% of the entire run's cost.**

Why 1:4 when every role agent achieves 1:11 or better:

1. **It is long-lived.** 11.5 hours, spanning every unit. Role agents live 5–30 minutes.
2. **It was resumed four times.** Each resume re-primes a large accumulated context as a
   fresh cache write.
3. **Its context grows monotonically.** Every subagent report, every commit, every decision
   accumulates. Each growth step invalidates the prefix beyond the insertion point.
4. **Cache TTL is 5 minutes by default.** Any gap longer than that — waiting on a 30-minute
   validator — expires the entry, so the next turn re-writes rather than reads.

Point 4 is the quiet one. **An orchestrator that blocks on long synchronous subagents will
almost always re-write its cache**, because the subagent outlives the TTL. The validators
here ran 8–31 minutes each.

By contrast, the unit-2 validator's 1:51 ratio is what good caching looks like: one long
uninterrupted session that writes its context once and reads it ~50 times.

---

## 6. Quantified waste

Two categories were unambiguously identifiable.

### 6.1 Duplicated validator — 3.15M tokens / $0.85

Unit 1 has **two** validator transcripts:

| Run | Window      | Duration | Tools | Tokens    |
| --- | ----------- | -------- | ----- | --------- |
| #1  | 11:23–11:54 | 31 min   | 62    | 3,796,968 |
| #2  | 12:35–12:44 | 9 min    | 49    | 3,146,748 |

The orchestrator reported _"Stopped before the Unit 1 validator ran"_ — but a transcript
already existed on disk. It had done 31 minutes and 62 tool calls of work, including mutation
testing, before being interrupted. A replacement was spawned and repeated the work.

**Lower-bound waste: 3,146,748 tokens ($0.85)** — more than the entire arm-A review stage
across all three units ($2.09 for 4 passes).

This is the orchestrator's _own_ interrupt-resilience rule failing to fire:

> **A subagent whose spawn was rejected mid-turn may still have left work on disk.** Always
> check the working tree after any interruption before spawning a replacement.

### 6.2 Rate-limit-killed runs — 1.24M tokens / $0.76

Four reviewer runs died mid-flight to session limits:

| Run                     | Tools | Output |  Tokens | Note                                                |
| ----------------------- | ----: | -----: | ------: | --------------------------------------------------- |
| Unit 2 reviewer (arm A) |    10 |     29 | 254,299 | killed at 13:41                                     |
| Unit 2 reviewer (arm B) |     1 |      4 |  27,355 | killed 4s in — **cache write 27,349, cache read 0** |
| Unit 3 reviewer (arm A) |    17 |  5,169 | 447,310 | killed at 16:36                                     |
| Unit 3 reviewer (arm B) |    13 |    751 | 511,400 | killed at 16:34                                     |

The arm-B unit-2 casualty is the purest illustration of the cost model: it paid **27,349
tokens of cache write and read back zero**. It died before a single read could amortise the
write. Every interrupted agent pays its cache-write premium and recovers none of it.

### 6.3 Total identified waste

|                      |        Tokens |      Cost | % of run |
| -------------------- | ------------: | --------: | -------: |
| Duplicated validator |     3,146,748 |     $0.85 |     5.7% |
| Killed reviewer runs |     1,240,364 |     $0.76 |     3.6% |
| **Total**            | **4,387,112** | **$1.60** | **7.9%** |

Real, and worth fixing. But note the comparison: **the orchestrator's cache-write premium
($5.66) is 3.5× all identified waste combined.** Structural cost dwarfs incidental waste.

---

## 7. Practical levers, ranked by measured impact

### 7.1 Shorten the orchestrator's context, not its output

The orchestrator wrote 8,494 output tokens across the run — $0.08. Its cache writes cost
$5.66. Any instruction aimed at making a coordinator terser is optimising a 1.4% line item.

What actually helps:

- **Delegate reading.** A coordinator that reads files itself carries them forever. One that
  spawns a scoped agent to read and report carries only the report.
- **Keep the protocol file external.** Already done here — standing detail lives in a scratch
  file subagents read themselves, rather than being re-explained in every spawn prompt.
- **Write state to disk, not to context.** The capture protocol meant every resume rebuilt
  from files rather than transcript. See [[06-agent-orchestration-efficiency]].

### 7.2 Consider the 1-hour cache TTL for long-blocking coordinators

Default TTL is 5 minutes; the validators here ran 8–31 minutes. A coordinator blocking on
them will re-write its prefix every cycle. The 1-hour TTL costs 2× on write instead of 1.25×,
so it needs ≥3 reads to pay off — but a coordinator that survives ten 20-minute subagent waits
gets those reads easily.

Not directly configurable from inside a Claude Code agent today, but it is the right mental
model for why long waits are expensive, and it is controllable when building on the API
directly.

### 7.3 Fix duplicate spawns before optimising anything else

One duplicated validator cost more than four review passes. The check is cheap: before
spawning a replacement role, `ls` the subagent transcript directory and inspect the working
tree.

### 7.4 Stop treating "be concise" as a cost lever

Output is 0.1% of volume, 2.7% of cost. Conciseness instructions are a **readability** lever,
not an economic one. Worth having — see the communication guidance in
[[06-agent-orchestration-efficiency]] — but not for the reason people usually give.

### 7.5 Measure before optimising a stage

The A/B in [[04-agent-review-stage-ab-test]] spent significant effort optimising the review
stage, which turned out to be ~10% of pipeline cost. Running `measure_tokens.py` against one
prior session would have shown that in a minute.

---

## 8. Reusable measurement recipe

```bash
# 1. Locate the session
ls ~/.claude/projects/<project-slug>/

# 2. Per-agent attribution (script in capture/)
python3 measure_tokens.py \
  ~/.claude/projects/<slug>/<session-id> \
  --json tokens.json

# 3. Cost-weight it — the raw token count hides the write premium
#    in=$2.00  out=$10.00  cache_write=$2.50  cache_read=$0.20  per MTok
```

Two disambiguation rules learned the hard way:

- **Interrupted runs leave short transcripts beside the real ones.** Separate by timestamp
  and shape: killed runs show single-digit tool counts and near-zero output (10 tools / 29
  output vs 36 / 2,103 for the real run).
- **Deduplicate by message id.** Streaming repeats a message across chunks; naive summation
  double-counts.

---

## External sources

- [Anthropic — Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — the prefix-match invariant, TTLs, and the write/read economics this note rests on
- [Anthropic — Pricing](https://platform.claude.com/docs/en/pricing) — current per-MTok rates by class
- [Anthropic — Token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting) — `count_tokens`; why not to use `tiktoken`
- [Anthropic — Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) — clearing stale tool results from a long-running agent's transcript
- [Anthropic — Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction) — server-side summarisation for conversations approaching the context window
- [Anthropic — Models overview](https://platform.claude.com/docs/en/about-claude/models/overview)

Repo-internal: `capture/measure_tokens.py`, `capture/tokens-final.json`,
[`.claude/agents/sequential-fix-orchestrator.md`](../.claude/agents/sequential-fix-orchestrator.md)
