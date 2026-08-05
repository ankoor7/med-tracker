# Agent Stage 3 Spec — Externalized State Ratchet (units file, failed-approaches log, bootstrap)

| | |
| --- | --- |
| **Depends on** | `.claude/agents/sequential-fix-orchestrator.md`, `scripts/agent-preflight.sh` |
| **Implements** | FR-A3.1 … FR-A3.7 |
| **Milestone** | Agent-method trial |
| **Status** | Tooling built 2026-07-31 (`scripts/agent/{state,ratchet}.mjs`, `agent-bootstrap.sh`, `agent-preflight.sh`, `docs/agent-protocol.md`); Tier-0 tests green (`pnpm agent:test`); Tier-2 fixture matrix pending |
| **Sources** | Anthropic *Effective harnesses for long-running agents*; Anthropic *long-running Claude* (CHANGELOG lesson); Ralph loop (`fix_plan.md` / `AGENT.md`) |

## 1. Objective

The orchestrator's run state currently lives in three places with no single source of
truth: its own transcript (expensive, lost at session boundaries), a prose handoff file
(free-form, written under end-of-unit pressure, unverifiable), and git history. The
baseline run's worst single waste — a validator respawned while its 31-minute transcript
sat on disk (3.15M tokens) — happened because "what has run and what passed" was a fact
the orchestrator *remembered* rather than a fact it *read*.

Every published long-running-agent harness converges on the same fix: **run state is a
small set of machine-readable files on disk, with a ratchet discipline, and every agent
cold-starts by reading them in a fixed order.** Anthropic's harness holds 200+ features
in a `feature_list.json` whose `passes` flags only ever go `false → true`; a
`claude-progress.txt` plus git log lets a fresh session resume with zero transcript
access; JSON is used over Markdown specifically because models overwrite prose but
respect structure. Their long-running-Claude work adds the missing half: a changelog of
**failed approaches**, because "without them, successive sessions will re-attempt the
same dead ends." Ralph allocates the same files deterministically every loop
(`fix_plan.md` for what's left, `AGENT.md` for how to run the project).

This stage builds that state layer. It has standalone value under the current resident
orchestrator (it hardens `agent-preflight.sh` and replaces the prose handoff), and it is
a hard prerequisite for Stage A4, whose ephemeral orchestrators have *nothing but* these
files.

## 2. Scope

**In:**
- A machine-readable **units file** with ratchet semantics — the single source of truth
  for what is done, in progress, bounced, or pending.
- A **failed-approaches log** — dead ends recorded so no future context retries them.
- A **deterministic bootstrap** — one script that answers "where am I?" for any
  cold-starting agent, replacing per-agent rediscovery.
- The **test-ratchet rule** in every role directive.
- Making `agent-preflight.sh` read the units file instead of heuristics over transcripts.

**Out:** the orchestrator lifecycle itself (Stage A4); role-directive efficiency
(Stage A2); the three personas (settled).

## 3. Prerequisites

- Trial subject and controls per [`trial-protocol.md`](trial-protocol.md).
- `scripts/measure-agent-tokens.py` (FR-A1.6) for the resume-cost measurement in AC-A3.4.
- **Isolation:** role agents MUST NOT read `specs/agent/**` or `research/04–06`
  (trial-protocol §3). The state files this stage adds live under `.agent/` in the
  worktree and are exempt — they are the run's working state, not the experiment's.

## 4. Functional requirements

- **FR-A3.1 — Units file with ratchet semantics.** Run state lives in
  `.agent/units.json`: one entry per unit with `id`, `title`, `spec_ref` (FR/AC IDs),
  `depends_on`, `status` (`pending | implementing | validating | reviewing | bounced |
  committed`), `committed_sha`, `bounce_count`, and `roles_run` (role → transcript path +
  outcome). **Ratchet rules:** `committed` is terminal and set only after `git log`
  confirms the SHA; entries are never deleted; acceptance-criteria references are never
  edited to make a unit pass (per Anthropic: "it is unacceptable to remove or edit tests
  because this could lead to missing or buggy functionality"). JSON, not Markdown —
  structure resists the accidental rewrites prose invites.
- **FR-A3.2 — Failed-approaches log.** `.agent/failed-approaches.md`, append-only. Any
  role that abandons an approach (implementer audit-gate stop, validator finding an
  unverifiable path, a bounced fix) MUST record: the approach, why it failed, and what
  not to retry — specific enough that a cold agent reading only this file will not
  re-attempt it. This is distinct from `docs/agent-learnings.md` (process lessons for
  future *runs*); this file is tactical state for *this* run and travels with the
  worktree.
- **FR-A3.3 — Deterministic bootstrap.** `scripts/agent-bootstrap.sh` prints, in fixed
  order: current unit and status from `units.json`; last 5 commits; working-tree
  status; dev-server/database liveness; the failed-approaches tail. Every spawned agent's
  directive begins "run the bootstrap script" — replacing the variable-cost exploratory
  discovery each agent currently does (baseline: 0.8% of spend was pure setup
  exploration, and each validator re-derived environment state on its own).
- **FR-A3.4 — Preflight reads the ratchet.** `agent-preflight.sh` MUST decide "prior
  work exists" from `units.json`'s `roles_run` plus working-tree state, not from
  transcript-directory heuristics. A role whose entry says it ran but produced no
  outcome is a *resume* case, never a *respawn* case.
- **FR-A3.5 — Writes are role-scoped.** Role agents update only their own `roles_run`
  entry and append to the failed-approaches log. Only the orchestrator changes `status`
  and `committed_sha`. This is Anthropic's separated-evaluation lesson applied to state:
  the agent that did the work never marks the work done.
- **FR-A3.6 — Test ratchet in every directive.** The shared protocol file MUST carry:
  tests may be added or strengthened, never deleted or weakened to get green, and any
  test change in a fix's diff is a reviewer-must-justify item. The validator's mutation
  pass already proves tests *can* fail; this rule prevents the cheaper failure of tests
  quietly ceasing to exist.
- **FR-A3.7 — Structured, two-sided learnings.** The learnings record MUST be
  machine-parseable and MUST capture strengths as well as weaknesses. Concretely:
  `.agent/learnings.jsonl` (mirrored in prose to `docs/agent-learnings.md` for humans),
  one entry per observation with `unit`, `role`, `kind`
  (`strength | weakness | bounce | doctrine-gap | doctrine-fired`), `evidence`
  (file:line, quoted directive, or transcript ref), and `action` (what a future
  directive or rule should repeat or change). This amends the doctrine's failure-only
  framing: "review went well" stays banned, but "this directive pattern landed
  first-try — quote it, reuse it" and "rule X fired and caught Y" become required
  entries — Stage A5's audit cannot classify a rule as *fired* without positive
  evidence, and a record of what works is what stops a later "improvement" from
  deleting it. The specificity bar is symmetric: a strength must be concrete enough to
  repeat, exactly as a weakness must be concrete enough to fix. Role reports MUST end
  with one line of raw material for this: what in the directive helped, what was
  missing.

## 5. Acceptance criteria

- **AC-A3.1 — Zero-transcript resume (gating).** Kill the run mid-unit (after the
  implementer, before the validator), delete access to all transcripts, and resume. The
  resumed run MUST proceed correctly — resume the right role, retry nothing recorded as
  failed, respawn nothing that ran — using only `.agent/` files and git.
- **AC-A3.2 — No duplicate spawns.** Across the trial, zero role agents re-execute work
  a `roles_run` entry already records, with the FR-A3.4 check visible before each spawn.
- **AC-A3.3 — No dead-end retries.** No agent in the trial attempts an approach already
  in the failed-approaches log. Verified by reading role transcripts against the log.
- **AC-A3.4 — Resume is cheap.** A resumed orchestrator reaches its first correct spawn
  decision within 10 turns and without reading any source file — bootstrap output and
  state files only.
- **AC-A3.5 — Ratchet integrity.** At run end, `units.json` history (it is committed per
  unit) shows no status ever moved backwards from `committed`, no entry deleted, and no
  spec/AC reference edited. Any test deleted or weakened during the trial appears with a
  reviewer justification.
- **AC-A3.6 — Learnings are two-sided and parseable.** After the trial,
  `learnings.jsonl` parses clean (every entry validates against the FR-A3.7 fields),
  contains ≥1 `strength` and ≥1 `weakness`-class entry per unit, and a one-line
  `jq` query can answer "which directives worked" and "what bounced and why" without
  reading any transcript. Entries whose `evidence` is empty or generic fail the run's
  audit.

## 6. Revert conditions

- Revert FR-A3.5 (role-scoped writes) if the bookkeeping measurably distracts role
  agents from their actual work — the state layer must cost less than the waste it
  prevents.
- The failed-approaches log has no revert condition; if entries go unread, fix the
  bootstrap ordering, not the log.

## 7. Open questions

- **Where does `.agent/` live?** ~~Open~~ **Settled 2026-07-31:** in the worktree, all of
  it committed. Git is the recovery mechanism, so state that git cannot see is state a
  resumed run cannot trust. One consequence found in testing and worth writing down:
  the ratchet is written *during* a unit, so `.agent/` is legitimately dirty mid-unit —
  `agent-preflight.sh` therefore excludes it from the abandoned-work check and reports
  it separately. Counting run-state churn as abandoned work would fire the alarm before
  every spawn, and an alarm that always fires is one nobody reads.
- **Schema for `roles_run` outcomes.** ~~Open~~ **Settled 2026-07-31:** both, as
  predicted — an enumerated `outcome` (`green | bounced | stopped-at-gate | hung |
  no-outcome`) that preflight branches on, plus a free-text `note` carrying the why.
  `hung` and `no-outcome` exist specifically because "ran but delivered nothing" and
  "never ran" look identical from the orchestrator's seat, and conflating them is what
  cost 3.15M tokens. Runs are stored as an append-only array per role, so a bounced
  unit's two implementer runs are both evidence.
- **Does the units file subsume HANDOFF.md?** The doctrine's session-boundary handoff
  becomes mostly derivable from `units.json` + failed-approaches. Keep HANDOFF.md for
  the human-facing narrative; generate its factual skeleton from the state files.

## 8. Test plan

Tiered so that model spend is reserved for claims only a model can answer. Tiers 0–1
MUST pass before any real-run trial spends tokens on this stage.

**Tier 0 — deterministic, zero tokens.** Everything in FR-A3.1–A3.6 except cold-start
realism is scripts and schemas; test with vitest/bash fixtures in-repo, no model:

- **Ratchet semantics:** attempt a backwards status move, an entry deletion, and a
  spec-ref edit against `units.json`; assert each is rejected/detected (AC-A3.5).
- **Preflight matrix:** fixture `.agent/` states — role ran green, role ran with no
  outcome, role never ran, tree dirty with stash — assert `agent-preflight.sh` returns
  resume/respawn/salvage correctly for each (AC-A3.2's mechanism).
- **Bootstrap determinism:** run `agent-bootstrap.sh` twice against a fixture worktree;
  byte-identical output, fixed section order, correct failed-approaches tail.
- **Learnings schema:** valid and invalid `learnings.jsonl` fixtures (missing
  `evidence`, unknown `kind`); assert validation fails closed, and the AC-A3.6 `jq`
  queries return correct answers on the valid fixture.
- **Role-scoped writes:** simulate a role agent writing outside its `roles_run` entry;
  assert detection (FR-A3.5).

These are permanent regression tests, not trial scaffolding — they live in the repo.

**Tier 2 — cold-start realism, cheap model, bounded.** AC-A3.1 and AC-A3.4 are the
stage's only model-dependent claims. Build ~6 fixture worktrees representing mid-run
states (mid-unit post-implementer, post-bounce, blocked unit, ceiling-killed partial,
clean boundary, dead-end recorded). Spawn a fresh orchestrator on a cheap model against
each with the instruction to **stop at the spawn decision** — no role agents run.
Assert: correct role chosen, resume-not-respawn where applicable, no retry of anything
in failed-approaches, ≤10 turns, no source file read. Cost: cents per fixture; the
matrix is re-runnable whenever the bootstrap or schema changes.

**What this stage never needs a full run for:** all of its ACs except AC-A3.3
(no dead-end retries under real conditions) are covered above; AC-A3.3 rides along on
Stage A4's single-unit smoke rather than buying its own trial.
