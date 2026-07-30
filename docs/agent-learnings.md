# Agent learnings

Append-only record of what each orchestrated run taught. Written by the
`sequential-fix-orchestrator` at every unit boundary (FR-A1.5 in
`specs/agent/agent-stage-1-orchestrator-efficiency.md`), and read at the start of
the next unit — this file, not the transcript, is what survives the per-unit
context reset.

**An entry has to be actionable.** "Review went well" is not an entry. An entry
names a `file:line`, quotes the directive that produced a bad result, or states
the rule that failed to fire. If a later unit's directive can't be changed
because of what you wrote, the entry was too vague.

Format, newest run first:

```markdown
## <date> — <stage / unit>

- **Bounced:** what came back wrong, which role caught it, and the root cause.
- **Directive:** a directive that produced a bad result, quoted, plus what it
  should have said.
- **Rule that didn't fire:** a doctrine rule in the agent file that should have
  prevented something and didn't.
- **Applied later:** how an earlier entry changed a directive in this same run.
```

---

## 2026-07-30 — A2 trial attempt 1 VOIDED (provider outage)

An Anthropic outage landed mid-run. Attempt 1 was discarded and the trial
restarted from `a3e5ae3`. What the void turned on, and what it did not:

- **An outage interrupts requests; it does not corrupt code.** Unit 1's work was
  independently verified sound before being discarded — green typecheck/lint,
  628 tests, `schedule.ts` absent from the diff (so its mutation really was
  restored), and all 19 escalation tests passing (so no mutation survived in the
  new file either). Work validity and measurement validity are separate questions
  and should be assessed separately.
- **The metrics were void, not adjustable.** Retries and a resume both force cache
  re-writes, so cost, cache write:read and wall-clock were measuring the incident.
  Critically, the outage and a wedged Playwright browser produce _the same
  signature_ — a transcript ending mid-tool-call — so the two causes could not be
  separated after the fact. **That inseparability is the reason to void rather
  than correct.** Do not attempt to subtract an incident from a measurement you
  cannot attribute.
- **Ratio ACs need an orchestrator-independent form.** AC-A2.5's "validator share
  of run cost" has the orchestrator in its denominator, so an orchestrator stall
  moves it while the validator is unchanged. Its "tokens per unit" half was
  untouched. Ratio-of-total criteria are fragile to infrastructure; absolute
  per-agent criteria are not. AC-A2.5 now gates on the absolute half.
- **Keep the safety net outside the experiment.** The restart deliberately ships
  no A1 tooling into the trial worktree — no `agent-preflight.sh`, no learnings
  file, no liveness clause. Operational guardrails are held externally instead
  (a staleness monitor, and preflight run from the main repo), so the run stays
  pure A2 while still being recoverable. A trial that cannot finish measures
  nothing, but a trial that smuggles in the other stage's intervention measures
  the wrong thing.
- **Preflight must report delivery, not duration.** Ported from the orchestrator's
  own script, which independently reached the same conclusion: a prior transcript
  is only actionable if you know whether it _delivered a report_, ended
  mid-tool-call, or was truncated. Turn count alone is what allowed "no report
  arrived" to be misread as "it never ran".

## 2026-07-30 — Agent Stage A2 trial, unit 1 (attempt 1, voided — kept for method value)

- **Rule that didn't fire, again:** the orchestrator reported "Stopped before the
  unit 1 validator ran" while a 56-turn, 34-tool validator transcript
  (`agent-af527349c6b68cfae`) sat on disk having spent $1.19. This is the
  baseline's most expensive failure reproduced almost verbatim, in a fresh run,
  on a worktree that deliberately did **not** carry the FR-A1.4 guard. So the
  failure is **structural, not a one-off**: an orchestrator that loses a subagent
  cannot tell "it never ran" from "it ran and died", because from its own vantage
  point both look like no report arriving. Its offer to "resume the unit 1
  validator; nothing needs redoing" would have produced a duplicate spawn.

  `scripts/agent-preflight.sh validator 1 <session>` surfaced the orphan in one
  command. This is the strongest evidence yet that FR-A1.4 has to be mechanical:
  the run that lacked the check repeated the exact defect the check was written
  for, while the check found it immediately.

- **Environmental, and expensive:** the validator hung on
  `mcp__playwright__browser_find` and never received a result — 409 minutes of
  wall clock, ~6.8h, for 26 turns, ending mid-tool-call with no report. Six
  Chrome processes were left wedged at 0% CPU while the dev server stayed healthy
  (HTTP 200 in 3ms), so the failure was the browser session, not the app. **A
  hung MCP call is indistinguishable from a slow subagent** from the outside,
  which is what let it burn most of a night. Worth a wall-clock ceiling per role
  spawn, after which the orchestrator checks liveness instead of continuing to
  wait. Recovery: `pkill -f "[C]hrome.*playwright"`, then resume — the dev server
  does not need restarting.

- **Cost shape of a stalled run:** orchestrator cache write:read degraded to
  **1:3** (baseline 1:4) and it took 46.6% of a partial run's cost on 17 turns.
  Long blocking waits are exactly where the ratio goes bad, which is the premise
  behind FR-A1.2.

- **Early A2 signal, not yet scoreable:** the unit-1 validator hit **1.31
  tools/turn** against the 1.07 baseline, and took **one** `browser_snapshot`
  (3KB) where the baseline unit-1 validator took six (31KB). Directionally what
  FR-A2.1 and FR-A2.2 intend. It cannot be scored against AC-A2.3/AC-A2.4 from an
  interrupted run — a validator that died before its interactive pass has an
  artificially low turn count.

---

## 2026-07-29 — Agent Stage 1, measurement harness

Not an orchestrated run: these came out of building `scripts/measure-agent-tokens.py`
against the 2026-07-28 baseline session.

- **Rule that didn't fire:** the interrupt-resilience rule "always check the
  working tree after any interruption before spawning a replacement" was already
  in the agent file during the baseline run and still lost 3.8M tokens to a
  duplicated Unit 1 validator. A rule the agent has to _remember_ under load is
  not a control. It is now a command — `scripts/agent-preflight.sh` — that must
  be run and shown before every spawn.

- **Measurement:** transcript `usage` blocks cannot be summed per record. One
  logical assistant message spans several records, each repeating the same
  prompt-side usage while `output_tokens` grows; only the last record carries the
  true total. Summing double-counts the prompt by ~2.3x; keeping only the first
  record undercounts output by ~6x and discards every tool call after the
  opening content block. Group by `message.id`, take prompt tokens once, take
  output at its maximum. The baseline's own figures carried the undercount —
  its 58,423 output tokens are really 366,644.

- **Measurement:** an unfinished run is detectable mechanically, without
  guessing from transcript length. Two signals flagged exactly the five
  known-waste runs of the baseline with no false positives: the final assistant
  message ends on a `tool_use` block (agent was still working), or the final
  message group reports zero output tokens (report cut off mid-emission).
  Tool-call count is a bad signal — a killed agent may have made dozens of calls
  first.

- **Control lost in the baseline:** all three implementers ran on
  `claude-opus-5`, not the `claude-sonnet-5` that `trial-protocol.md` §4 pins as
  the role model. The agent file's own "Model selection" section sanctions opus
  for architecturally hard implementers, so the doctrine and the trial control
  contradict each other. Any cost delta measured on implementers is confounded
  until that is settled.
