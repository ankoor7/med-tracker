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
