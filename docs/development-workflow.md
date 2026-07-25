# Development workflow — spec-driven, agent-run

This is how work gets built on SteadyDose. Two ideas: **specs are the source of
truth**, and **each unit of work runs through an Implement → Validate → Review
loop**, one commit at a time.

## Spec-driven development

- `specs/` holds the product, architecture, and per-stage specs. They are the
  authority for what to build and what "done" means — not the transcript, not a
  commit message.
- Each stage spec enumerates **functional requirements** (`FR-n.m`) with
  **acceptance criteria** (`ACn`). A fix is finished when its ACs are met in the
  running app, not when a test goes green.
- Work is sequenced in `specs/03-implementation-plan.md`. Build in stage order;
  within a stage, order units by dependency, not by spec order.
- **Settle open questions in the spec, not the chat.** When the user decides
  something (a product default, a data-model choice), strike the open question and
  record the decision in the spec so it survives the session.
- When scope is discovered mid-stage (a new FR, a pre-existing bug made
  reachable), add it to the spec as its own FR/unit rather than bolting it onto
  the current diff.

## The agent loop (Implement → Validate → Review)

Each unit of work is driven to completion by three short-lived subagents run **in
sequence, synchronously** — they share one browser and one working tree, so they
must not run concurrently. This is the job of the
[`sequential-fix-orchestrator`](../.claude/agents/sequential-fix-orchestrator.md)
agent; invoke it when the work is enumerable up front and each item is
independently shippable.

1. **IMPLEMENTER** — writes the fix and its tests; ends on a green build. Stops
   and reports if the unit's premise turns out unsound.
2. **VALIDATOR** — verifies each AC live in the app, then **mutation-tests** the
   new tests: reverts the fix, confirms the tests fail, restores. A test that
   cannot fail is worthless.
3. **REVIEWER** — reads the whole diff for correctness, fit, and boundary
   respect, and clears the commit gate (fallow `*_introduced` at 0).

Then **one unit = one commit**, with a message that explains the _why_. Never
batch two units into one commit. Roughly one unit in three bounces back at least
once — that is the process working.

- **Review and validation catch different bug classes** — a clean live validation
  is not licence to skip review.
- **A subagent's self-assessment is a claim to verify, not a fact to relay** —
  especially before passing it to the user.

The full playbook — writing directives that land, model selection, splitting
oversized units, interrupt resilience, and the hard-won lessons — lives in the
[`sequential-fix-orchestrator`](../.claude/agents/sequential-fix-orchestrator.md)
agent definition.

## Handoff

At a session boundary, the state that matters is written to `HANDOFF.md` (leads
with any uncommitted work, then committed units, then what remains, then the
gotchas) and reflected back into the specs. The next session sees only what was
written down and committed — not the transcript.
