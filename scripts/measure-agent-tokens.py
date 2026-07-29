#!/usr/bin/env python3
"""Attribute Claude Code subagent token usage per role, cost-weighted.

Reads a Claude Code session directory and reports, per subagent, the four token
classes plus cost, so an orchestrated run can be compared against a baseline.
See specs/agent/agent-stage-1-orchestrator-efficiency.md (FR-A1.6).

    ./scripts/measure-agent-tokens.py <session-dir> [--json out.json]

<session-dir> is  ~/.claude/projects/<project-slug>/<session-id>/  — it must
contain a subagents/ directory of agent-<id>.jsonl + agent-<id>.meta.json pairs.

Two rate modes:
  (default)            price each message at its own model's rates
  --flat-rate MODEL    price every message as MODEL, which is how the
                       2026-07-28 baseline in the spec was computed

Cost model: a cache write costs 1.25x input (5m TTL) or 2x (1h); a cache read
costs 0.1x. That 12.5x write:read spread is why this script exists — raw token
counts hide it.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

# $ per million tokens, base input/output. Cache classes are derived multiples.
# Sonnet 5 is at introductory pricing through 2026-08-31 ($3.00/$15.00 after).
RATES: dict[str, tuple[float, float]] = {
    "claude-fable-5": (10.00, 50.00),
    "claude-mythos-5": (10.00, 50.00),
    "claude-opus-5": (5.00, 25.00),
    "claude-opus-4-8": (5.00, 25.00),
    "claude-opus-4-7": (5.00, 25.00),
    "claude-opus-4-6": (5.00, 25.00),
    "claude-sonnet-5": (2.00, 10.00),
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-haiku-4-5": (1.00, 5.00),
}
FALLBACK_RATE = RATES["claude-sonnet-5"]

CACHE_WRITE_5M = 1.25  # x input
CACHE_WRITE_1H = 2.00  # x input
CACHE_READ = 0.10  # x input

# Two mechanical signals separate a killed run from a completed one. Both were
# validated against the five known-waste runs of the 2026-07-28 baseline and
# flag exactly those five, with no false positives:
#
#   ends-mid-tool-call      last assistant message ends on a tool_use block —
#                           the agent was still working. Caught the duplicated
#                           validator that cost 3.1M tokens.
#   truncated-final-message final message group reports 0 output tokens, so the
#                           report was cut off mid-emission. Caught all four
#                           rate-limit-killed reviewers.
#
# Tool-call count is a poor signal on its own: a killed agent may have made
# dozens of calls before dying.


@dataclass
class Agent:
    agent_id: str
    agent_type: str = ""
    description: str = ""
    spawn_depth: int = 0
    model_counts: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    turns: int = 0
    tool_calls: int = 0
    tool_counts: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    tool_result_bytes: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    input_tokens: int = 0
    output_tokens: int = 0
    cache_write_5m: int = 0
    cache_write_1h: int = 0
    cache_read: int = 0
    cost: float = 0.0
    first_ts: str | None = None
    last_ts: str | None = None
    final_block: str = ""
    final_output: int = 0
    flags: list[str] = field(default_factory=list)

    @property
    def cache_write(self) -> int:
        return self.cache_write_5m + self.cache_write_1h

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens + self.cache_write + self.cache_read

    @property
    def model(self) -> str:
        if not self.model_counts:
            return "-"
        return max(self.model_counts.items(), key=lambda kv: kv[1])[0]

    @property
    def write_read_ratio(self) -> str:
        if not self.cache_write:
            return "-"
        return f"1:{self.cache_read / self.cache_write:.0f}"

    @property
    def tools_per_turn(self) -> float:
        return self.tool_calls / self.turns if self.turns else 0.0

    @property
    def avg_context(self) -> int:
        """Mean prompt size per turn — the thing a cache write pays for."""
        if not self.turns:
            return 0
        return (self.input_tokens + self.cache_write + self.cache_read) // self.turns

    @property
    def duration_min(self) -> float | None:
        if not (self.first_ts and self.last_ts):
            return None
        try:
            start = datetime.fromisoformat(self.first_ts.replace("Z", "+00:00"))
            end = datetime.fromisoformat(self.last_ts.replace("Z", "+00:00"))
        except ValueError:
            return None
        return (end - start).total_seconds() / 60


def classify(agent: Agent) -> tuple[str, int | None]:
    """Map an agent to (role, unit). Role drives the rollup table."""
    text = f"{agent.agent_type} {agent.description}".lower()

    if "orchestrator" in agent.agent_type.lower():
        role = "orchestrator"
    elif agent.agent_type in ("Explore", "Plan"):
        # Checked before the keyword rules: a scouting agent's description may
        # itself name a role ("Find open-code-review-delegate skill").
        role = "setup"
    elif re.search(r"implement", text):
        role = "implementer"
    elif re.search(r"validat", text):
        role = "validator"
    elif re.search(r"review", text):
        role = "reviewer"
    elif re.search(r"explore|locate", text):
        role = "setup"
    else:
        role = "other"

    unit_match = re.search(r"unit\s*(\d+)", text)
    return role, int(unit_match.group(1)) if unit_match else None


def price(model: str, usage: dict, flat_rate: str | None) -> float:
    rate_key = flat_rate or model
    inp, out = RATES.get(rate_key, FALLBACK_RATE)
    creation = usage.get("cache_creation") or {}
    w5m = creation.get("ephemeral_5m_input_tokens")
    w1h = creation.get("ephemeral_1h_input_tokens", 0)
    if w5m is None:
        # Older transcripts carry only the aggregate; assume the 5m default.
        w5m = usage.get("cache_creation_input_tokens", 0)
    return (
        usage.get("input_tokens", 0) * inp
        + usage.get("output_tokens", 0) * out
        + w5m * inp * CACHE_WRITE_5M
        + w1h * inp * CACHE_WRITE_1H
        + usage.get("cache_read_input_tokens", 0) * inp * CACHE_READ
    ) / 1_000_000


def read_agent(jsonl: Path, flat_rate: str | None) -> Agent:
    agent = Agent(agent_id=jsonl.stem)

    meta_path = jsonl.with_suffix(".meta.json")
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
        agent.agent_type = meta.get("agentType") or ""
        agent.description = meta.get("description") or ""
        agent.spawn_depth = meta.get("spawnDepth") or 0

    # One logical assistant message is written as several records, one content
    # block each. Every record repeats the same prompt-side usage, but
    # output_tokens grows as the message is emitted and only the last record
    # carries the true total. So group by message id, then take prompt tokens
    # once and output tokens at their maximum. Summing records double-counts
    # the prompt; keeping only the first throws away the output and every tool
    # call after the opening block.
    groups: dict[str, list[dict]] = {}
    order: list[str] = []
    tool_name_by_id: dict[str, str] = {}
    results: list[tuple[str, int]] = []  # (tool_use_id, result bytes)
    with jsonl.open() as handle:
        for index, line in enumerate(handle):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue

            timestamp = record.get("timestamp")
            if timestamp:
                if agent.first_ts is None or timestamp < agent.first_ts:
                    agent.first_ts = timestamp
                if agent.last_ts is None or timestamp > agent.last_ts:
                    agent.last_ts = timestamp

            message = record.get("message") or {}
            content = message.get("content")

            if record.get("type") == "user":
                # Tool results come back on user turns. Size them so we can see
                # which tool is actually filling the context (FR-A2.8).
                for block in content if isinstance(content, list) else []:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        body = block.get("content")
                        size = len(body if isinstance(body, str) else json.dumps(body or ""))
                        results.append((block.get("tool_use_id") or "", size))
                continue

            if record.get("type") != "assistant":
                continue
            if not message.get("usage"):
                continue

            key = message.get("id") or f"__anon-{index}"
            if key not in groups:
                groups[key] = []
                order.append(key)
            groups[key].append(message)

            for block in content if isinstance(content, list) else []:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    tool_name_by_id[block.get("id") or ""] = block.get("name") or "?"

    for key in order:
        messages = groups[key]
        first = messages[0]
        usage = dict(first.get("usage") or {})
        usage["output_tokens"] = max(
            (m.get("usage") or {}).get("output_tokens", 0) for m in messages
        )

        model = first.get("model") or "-"
        agent.model_counts[model] += 1
        agent.turns += 1
        for message in messages:
            blocks = message.get("content")
            for block in blocks if isinstance(blocks, list) else []:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    agent.tool_calls += 1
                    agent.tool_counts[block.get("name") or "?"] += 1

        creation = usage.get("cache_creation") or {}
        w5m = creation.get("ephemeral_5m_input_tokens")
        if w5m is None:
            w5m = usage.get("cache_creation_input_tokens", 0)
        agent.cache_write_5m += w5m
        agent.cache_write_1h += creation.get("ephemeral_1h_input_tokens", 0)
        agent.input_tokens += usage.get("input_tokens", 0)
        agent.output_tokens += usage["output_tokens"]
        agent.cache_read += usage.get("cache_read_input_tokens", 0)
        agent.cost += price(model, usage, flat_rate)

    for tool_use_id, size in results:
        agent.tool_result_bytes[tool_name_by_id.get(tool_use_id, "?")] += size

    if order:
        final = groups[order[-1]]
        blocks = [
            block.get("type")
            for message in final
            for block in (message.get("content") or [])
            if isinstance(block, dict)
        ]
        agent.final_block = blocks[-1] if blocks else ""
        agent.final_output = max(
            (m.get("usage") or {}).get("output_tokens", 0) for m in final
        )

    return agent


def flag_waste(agents: list[Agent], keys: dict[str, tuple[str, int | None]]) -> None:
    """Flag runs that did not finish, and spend that bought nothing."""
    for agent in agents:
        if agent.final_block == "tool_use":
            agent.flags.append("ends-mid-tool-call")
        if agent.turns and not agent.final_output:
            agent.flags.append("truncated-final-message")
        if agent.cache_write and not agent.cache_read:
            # Died before a single read could amortise the write premium.
            agent.flags.append("paid-write-read-nothing")

    # More than one transcript for the same role+unit is either a legitimate
    # send-work-back round or a duplicate spawn (FR-A1.4). Surface it either
    # way; the operator can tell which from the descriptions.
    groups: dict[tuple[str, int | None], list[Agent]] = defaultdict(list)
    for agent in agents:
        groups[keys[agent.agent_id]].append(agent)
    for key, group in groups.items():
        if key[1] is not None and len(group) > 1:
            for agent in group:
                agent.flags.append(f"repeat-{key[0]}-unit{key[1]} (x{len(group)})")


def wasted(agent: Agent) -> bool:
    return any(
        flag in ("ends-mid-tool-call", "truncated-final-message", "paid-write-read-nothing")
        for flag in agent.flags
    )


def fmt(n: int) -> str:
    return f"{n:,}"


def report(agents: list[Agent], flat_rate: str | None, session: Path) -> dict:
    keys = {a.agent_id: classify(a) for a in agents}
    flag_waste(agents, keys)

    total_cost = sum(a.cost for a in agents) or 1.0
    total_tokens = sum(a.total_tokens for a in agents) or 1

    print(f"\nSession: {session}")
    print(f"Agents: {len(agents)}   Rate mode: {flat_rate or 'per-message model'}")

    print("\n== Per agent ==")
    header = (
        f"{'role':<13}{'u':<3}{'model':<17}{'tokens':>12}{'cost':>9}"
        f"{'w:r':>7}{'turns':>7}{'tools':>7}{'ctx/turn':>10}{'min':>7}  desc"
    )
    print(header)
    print("-" * len(header))
    for agent in sorted(agents, key=lambda a: -a.cost):
        role, unit = keys[agent.agent_id]
        duration = agent.duration_min
        note = agent.description
        if agent.flags:
            note = f"{note}  [{', '.join(agent.flags)}]"
        print(
            f"{role:<13}{unit if unit else '-':<3}{agent.model:<17}"
            f"{fmt(agent.total_tokens):>12}{agent.cost:>9.2f}"
            f"{agent.write_read_ratio:>7}{agent.turns:>7}{agent.tool_calls:>7}"
            f"{fmt(agent.avg_context):>10}"
            f"{f'{duration:.0f}' if duration is not None else '-':>7}  {note}"
        )

    print("\n== By role ==")
    print(f"{'group':<16}{'n':>4}{'tokens':>14}{'% tok':>8}{'cost':>9}{'% cost':>9}{'w:r':>8}")
    rollup: dict[str, list[Agent]] = defaultdict(list)
    for agent in agents:
        rollup[keys[agent.agent_id][0]].append(agent)
    role_summary = {}
    for role in ("orchestrator", "validator", "implementer", "reviewer", "setup", "other"):
        group = rollup.get(role)
        if not group:
            continue
        tokens = sum(a.total_tokens for a in group)
        cost = sum(a.cost for a in group)
        writes = sum(a.cache_write for a in group)
        reads = sum(a.cache_read for a in group)
        ratio = f"1:{reads / writes:.0f}" if writes else "-"
        print(
            f"{role:<16}{len(group):>4}{fmt(tokens):>14}{tokens / total_tokens * 100:>7.1f}%"
            f"{cost:>9.2f}{cost / total_cost * 100:>8.1f}%{ratio:>8}"
        )
        role_summary[role] = {
            "agents": len(group),
            "tokens": tokens,
            "token_share": tokens / total_tokens,
            "cost": round(cost, 4),
            "cost_share": cost / total_cost,
            "cache_write": writes,
            "cache_read": reads,
        }
    print(f"{'TOTAL':<16}{len(agents):>4}{fmt(total_tokens):>14}{'':>8}{total_cost:>9.2f}")

    print("\n== By token class ==")
    classes = {
        "cache read": (sum(a.cache_read for a in agents), CACHE_READ),
        "cache write 5m": (sum(a.cache_write_5m for a in agents), CACHE_WRITE_5M),
        "cache write 1h": (sum(a.cache_write_1h for a in agents), CACHE_WRITE_1H),
        "output": (sum(a.output_tokens for a in agents), None),
        "input": (sum(a.input_tokens for a in agents), 1.0),
    }
    print(f"{'class':<16}{'tokens':>14}{'% volume':>11}")
    class_summary = {}
    for name, (tokens, _) in classes.items():
        print(f"{name:<16}{fmt(tokens):>14}{tokens / total_tokens * 100:>10.1f}%")
        class_summary[name] = tokens

    # FR-A2.8: which tool is filling the context, and is the agent batching?
    print("\n== Tool profile ==")
    print(f"{'role':<13}{'u':<3}{'turns':>7}{'tools':>7}{'t/turn':>8}  top tools by result bytes")
    for agent in sorted(agents, key=lambda a: -a.total_tokens):
        if not agent.tool_calls:
            continue
        role, unit = keys[agent.agent_id]
        top = sorted(agent.tool_result_bytes.items(), key=lambda kv: -kv[1])[:4]
        detail = "  ".join(
            f"{name}={agent.tool_counts.get(name, 0)}c/{size // 1024}KB" for name, size in top
        )
        print(
            f"{role:<13}{unit if unit else '-':<3}{agent.turns:>7}{agent.tool_calls:>7}"
            f"{agent.tools_per_turn:>8.2f}  {detail}"
        )

    by_tool: dict[str, tuple[int, int]] = {}
    for agent in agents:
        for name, count in agent.tool_counts.items():
            calls, size = by_tool.get(name, (0, 0))
            by_tool[name] = (calls + count, size + agent.tool_result_bytes.get(name, 0))
    total_bytes = sum(size for _, size in by_tool.values()) or 1
    print(f"\n{'tool':<28}{'calls':>7}{'result KB':>12}{'% content':>11}")
    for name, (calls, size) in sorted(by_tool.items(), key=lambda kv: -kv[1][1])[:12]:
        print(f"{name:<28}{calls:>7}{size // 1024:>12}{size / total_bytes * 100:>10.1f}%")

    flagged = [a for a in agents if a.flags]
    waste_cost = sum(a.cost for a in agents if wasted(a))
    if flagged:
        print("\n== Flagged ==")
        for agent in flagged:
            print(
                f"  {'WASTE' if wasted(agent) else 'check':<6} ${agent.cost:>6.2f}  "
                f"{fmt(agent.total_tokens):>11} tok  {', '.join(agent.flags)}"
                f"  — {agent.description}"
            )
        print(
            f"\n  Unfinished-run spend: ${waste_cost:.2f} "
            f"({waste_cost / total_cost * 100:.1f}% of run)"
        )

    return {
        "session": str(session),
        "rate_mode": flat_rate or "per-model",
        "total_tokens": total_tokens,
        "total_cost": round(total_cost, 4),
        "by_role": role_summary,
        "by_class": class_summary,
        "unfinished_run_cost": round(waste_cost, 4),
        "agents": [
            {
                "id": a.agent_id,
                "role": keys[a.agent_id][0],
                "unit": keys[a.agent_id][1],
                "agent_type": a.agent_type,
                "description": a.description,
                "spawn_depth": a.spawn_depth,
                "model": a.model,
                "turns": a.turns,
                "tool_calls": a.tool_calls,
                "input_tokens": a.input_tokens,
                "output_tokens": a.output_tokens,
                "cache_write_5m": a.cache_write_5m,
                "cache_write_1h": a.cache_write_1h,
                "cache_read": a.cache_read,
                "total_tokens": a.total_tokens,
                "cost": round(a.cost, 4),
                "tools_per_turn": round(a.tools_per_turn, 3),
                "tool_counts": dict(a.tool_counts),
                "tool_result_bytes": dict(a.tool_result_bytes),
                "avg_context_per_turn": a.avg_context,
                "duration_min": round(a.duration_min, 1) if a.duration_min is not None else None,
                "flags": a.flags,
            }
            for a in sorted(agents, key=lambda a: -a.cost)
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("session_dir", type=Path, help="~/.claude/projects/<slug>/<session-id>")
    parser.add_argument("--json", type=Path, help="also write the full report here")
    parser.add_argument(
        "--flat-rate",
        metavar="MODEL",
        help="price every message as MODEL (use claude-sonnet-5 to reproduce the spec baseline)",
    )
    parser.add_argument(
        "--include-main",
        action="store_true",
        help="also attribute the top-level session transcript, not just subagents/",
    )
    args = parser.parse_args()

    session = args.session_dir.expanduser()
    if not session.is_dir():
        print(f"error: not a directory: {session}", file=sys.stderr)
        return 1

    if args.flat_rate and args.flat_rate not in RATES:
        print(
            f"error: unknown model {args.flat_rate!r}; known: {', '.join(sorted(RATES))}",
            file=sys.stderr,
        )
        return 1

    paths = sorted((session / "subagents").glob("agent-*.jsonl"))
    if args.include_main:
        paths += sorted(session.glob("*.jsonl"))
    if not paths:
        print(f"error: no transcripts under {session}/subagents/", file=sys.stderr)
        return 1

    agents = [read_agent(p, args.flat_rate) for p in paths]
    agents = [a for a in agents if a.total_tokens]
    if not agents:
        print("error: transcripts contained no usage data", file=sys.stderr)
        return 1

    payload = report(agents, args.flat_rate, session)

    if args.json:
        args.json.write_text(json.dumps(payload, indent=2))
        print(f"\nWrote {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
