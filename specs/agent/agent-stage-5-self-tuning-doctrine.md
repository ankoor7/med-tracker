# Agent Stage 5 Spec — Self-Tuning Doctrine (signs, pruning, model-role fitting)

| | |
| --- | --- |
| **Depends on** | `agent-stage-3-state-ratchet.md` (FR-A3.7 two-sided learnings are this stage's input), `agent-stage-4-ephemeral-orchestrator.md` FR-A4.7 (run report), `.claude/agents/sequential-fix-orchestrator.md` |
| **Implements** | FR-A5.1 … FR-A5.5 |
| **Milestone** | Agent-method trial |
| **Status** | Draft |
| **Sources** | Ralph loop ("signs"); Cursor *Scaling agents* (prompting as primary lever; simplicity by removal; empirical model-role fit); Anthropic three-agent harness (calibrated evaluator rubrics) |

## 1. Objective

The agent doctrine (`sequential-fix-orchestrator.md`) is 347 lines and grows monotonically:
every incident adds a rule, no rule is ever removed, and every added rule is context every
future orchestrator pays for on every turn. Three of the linked companies' lessons say
this file is itself a long-running system that needs the same discipline as the runs it
governs:

- **Ralph's "signs":** bad behaviour patterns get addressed with new prompt
  instructions — but Huntley also periodically deletes and rebuilds the plan when it
  goes stale. The counterpart for doctrine: a rule that never fires is context cost with
  no return.
- **Cursor:** "a surprising amount of the system's behavior comes down to how we prompt
  the agents" — prompting is the *primary* lever, which cuts both ways: it is also the
  primary place cruft accumulates. Their single biggest architectural improvement was
  *removing* a role (the integrator) that "created more bottlenecks than it solved."
- **Cursor on models:** role fit is empirical and counterintuitive — their general
  model out-planned their coding-tuned model, and Opus "tends to stop earlier and take
  shortcuts" in their worker role. The doctrine's current model-selection section is an
  untested prior stated as a rule.

This stage closes the loop that FR-A1.5 opened: learnings are currently *captured*
durably but *applied* manually and never retired. It makes doctrine changes traceable to
incidents, prunes rules that stopped earning their context cost, and replaces the
model-selection prior with measured assignments.

## 2. Scope

**In:** the doctrine-change ledger; a per-run doctrine audit (which rules fired, which
were violated, which never engaged); rule pruning with provenance; model-role A/B
measurement; calibrated bounce rubrics for validator/reviewer reports.

**Out:** the doctrine's *content* on process safety (mutation proof, send-back, one
unit one commit — settled); automation that edits the doctrine without user review
(changes are proposed, the user merges).

## 3. Prerequisites

- Stages A3/A4 landed or explicitly deferred — this stage audits whatever doctrine is
  then current; it does not depend on their outcome, only on knowing it.
- ≥2 measured full runs, so "fired / never fired" has data behind it.
- `pnpm agent:measure` per-model output (FR-A1.6) for the model-fitting arithmetic.

## 4. Functional requirements

- **FR-A5.1 — Doctrine-change ledger.** Every rule added to or removed from the agent
  file MUST carry provenance: the incident (a learnings-file entry, a run-log event, or
  a spec) that motivated it, and the date. New rules without an incident are priors and
  MUST be marked as such. Ledger lives as an appendix or sidecar
  (`docs/agent-doctrine-ledger.md`), not inline noise in the prompt itself.
- **FR-A5.2 — Per-run doctrine audit.** At run end, one bounded pass (a cheap agent
  reading `run-log.jsonl`, `learnings.jsonl`, and the doctrine — naturally combined
  with FR-A4.7's synthesis pass) classifies each rule: **fired** (observably changed
  behaviour), **violated** (should have fired, didn't — these are the bugs), or
  **dormant**. Output appends to the ledger. The *fired* classification depends on
  FR-A3.7's `strength`/`doctrine-fired` entries — a failure-only learnings record makes
  every working rule look dormant and would mark the doctrine's best rules for pruning,
  which is why two-sided capture is a hard input here, not a nice-to-have.
- **FR-A5.3 — Pruning rule.** A rule dormant across 3 consecutive runs is proposed for
  removal or demotion to the ledger (where it remains recoverable). Safety-critical
  rules (mutation proof, test ratchet, no-secrets) are exempt and marked so. The test is
  Cursor's: does removing it make the system simpler without making it worse — trialled
  by removal, watched via the parity ACs already in force (AC-A2.1/AC-A4.1 class).
- **FR-A5.4 — Empirical model-role fitting.** The doctrine's model-selection section is
  replaced by a measured table: for each role, at least one A/B on the trial units
  (top-tier vs mid-tier), scored on the role's own outcome metric — implementer: bounce
  rate; validator: defects found + mutations killed; reviewer: genuine findings per
  pass; orchestrator (if A4 landed): directive quality via bounce rate. Cost per unit is
  reported alongside. The winning assignment is written into the doctrine *with its
  numbers and date*, and re-checked when models change. Priors — including "Opus takes
  shortcuts" from Cursor — are hypotheses to test here, not conclusions to import.
- **FR-A5.5 — Calibrated bounce rubric.** Validator and reviewer reports MUST end with
  a scored verdict against fixed dimensions (correctness, honesty-of-tests, fit,
  UX-clarity — final set to be settled in the protocol file), each with an anchor
  example of a pass and a fail, per Anthropic's evaluator design ("calibrated scoring
  criteria and few-shot examples" against four named dimensions). Bounce decisions cite
  the failing dimension. This makes AC-parity comparisons across runs measurable instead
  of vibes, and it is what FR-A5.2's audit reads to decide whether review rules fired.

## 5. Acceptance criteria

- **AC-A5.1** — Every rule in the current doctrine appears in the ledger with
  provenance or an explicit `prior` marker. (One-time back-fill; new changes maintain it.)
- **AC-A5.2** — After the next full run, the audit exists and classifies every rule;
  at least one `violated` or `dormant` finding leads to a concrete proposal (a doctrine
  edit or a mechanisation, e.g. a rule becoming a script the way FR-A1.4 did).
- **AC-A5.3** — The doctrine file's prompt-visible length does not grow run-over-run
  unless the ledger shows a new incident per added rule. Net growth without incidents
  fails.
- **AC-A5.4** — A model-role table with measured numbers replaces the current
  model-selection prose, and at least one role's assignment was decided by the data
  rather than the prior (either confirming it with numbers or overturning it).
- **AC-A5.5** — Bounce verdicts in the trial cite rubric dimensions; a re-run's
  findings can be compared dimension-by-dimension against baseline without re-reading
  full reports.

## 6. Revert conditions

- **Revert FR-A5.3 (pruning)** if a pruned rule's incident class recurs within the next
  two runs — restore it from the ledger with the recurrence noted. That is the pruning
  loop working, not failing; the ledger exists precisely so removal is cheap to undo.
- **Revert FR-A5.5 (rubric)** if scored verdicts make reports *less* honest — e.g.
  dimensions scored to pass while the prose reservations disappear. Honest-limits
  reporting (FR-A2.7) outranks comparability.

## 7. Open questions

- **Who runs the audit?** FR-A4.7's end-of-run synthesis agent is the natural owner —
  same inputs, same moment, one spawn. Start agent-drafted, user-merged — consistent
  with the "changes are proposed" scope line.
- **Doctrine size target.** Is there a number? Cursor's lesson is directional
  (simplicity wins), not quantitative. Proposal: no target, but AC-A5.3's no-silent-growth
  rule plus per-turn context cost in the measurement output keeps the pressure visible.
- **Cross-repo generality.** The doctrine mixes universal rules (send-back, ratchet)
  with med-tracker specifics (pre-commit timeout, pager hangs). If the agent method
  outlives this repo, the ledger's provenance field is what makes the split obvious
  later — worth structuring for it now?

## 8. Test plan

- **Ledger and back-fill (FR-A5.1, AC-A5.1):** zero tokens — the back-fill is a
  documentation pass, and a repo test asserts every doctrine rule has a ledger entry
  with provenance or a `prior` marker (greppable structure, enforced like a schema).
- **Audit on replayed data (FR-A5.2):** develop against the baseline-transcript corpus
  built in Stage A4's Tier 1, cheap model. Ground truth exists: the baseline analysis
  already names rules that were violated (the duplicate spawn — the remembered
  pre-spawn rule; the two progress stalls) and rules that fired. The audit must
  reproduce those classifications from the corpus before it is trusted on a live run.
- **Pruning (FR-A5.3):** no dedicated spend — it is a policy over audit outputs;
  test the 3-runs-dormant logic with fixture ledgers, zero tokens.
- **Rubric (FR-A5.5):** trial on Stage A4's single-unit smoke, not a dedicated run —
  the check is that scored verdicts appear and prose reservations do not disappear
  (the FR-A2.7 honesty bar), which one unit demonstrates.
- **Model-role A/Bs (FR-A5.4) are deliberately last and gated:** run only after A3/A4
  have settled the lifecycle, because fitting models to roles whose shape is changing
  measures a configuration about to be deleted. This is the most expensive experiment
  in the A-series; everything above it must be green first, and the A/B reuses the
  trial-protocol units so the baseline is free.
