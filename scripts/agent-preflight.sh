#!/usr/bin/env bash
# Pre-spawn check for the sequential-fix-orchestrator (FR-A1.4).
#
#   ./scripts/agent-preflight.sh <role> <unit> [session-dir]   e.g. validator 2
#
# session-dir defaults to the most recently touched session for this repo, which
# is the run in progress. Pass it explicitly to audit an earlier run.
#
# Run this before EVERY role spawn. It answers one question: does work for this
# role+unit already exist? A duplicated validator in the 2026-07-28 baseline
# cost 3.8M tokens — more than every review pass in that run combined — because
# the orchestrator believed a subagent "hadn't run" while its 31-minute
# transcript sat on disk.
#
# Exit 0 = clear to spawn. Exit 3 = prior work found; resume or salvage it
# instead of spawning a replacement.

set -uo pipefail

ROLE="${1:-}"
UNIT="${2:-}"
if [[ -z "$ROLE" || -z "$UNIT" ]]; then
  echo "usage: $0 <role> <unit>   (role: implementer|validator|reviewer)" >&2
  exit 2
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SLUG="$(printf '%s' "$REPO_ROOT" | tr '/' '-')"
PROJECT_DIR="$HOME/.claude/projects/$SLUG"

found=0

echo "=== Pre-spawn check: $ROLE / unit $UNIT ==="

echo
echo "--- Working tree ---"
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]]; then
  git -C "$REPO_ROOT" status --short
  echo "!! Uncommitted changes present. A prior agent may have left this."
  found=1
else
  echo "clean"
fi

echo
echo "--- Stashes ---"
if [[ -n "$(git -C "$REPO_ROOT" stash list 2>/dev/null)" ]]; then
  git -C "$REPO_ROOT" stash list
  echo "!! Stashed work present — a validator's mutation test may have aborted."
  found=1
else
  echo "none"
fi

echo
echo "--- Recent commits ---"
git -C "$REPO_ROOT" log --oneline -5 2>/dev/null || echo "(no commits)"

echo
echo "--- Existing transcripts for $ROLE / unit $UNIT ---"
# Newest session first: the run in progress is the one being appended to.
latest_session="${3:-$(ls -dt "$PROJECT_DIR"/*/ 2>/dev/null | head -1)}"
if [[ -z "$latest_session" ]]; then
  echo "(no session directory under $PROJECT_DIR)"
else
  matches="$(
    grep -ril "unit *$UNIT" "$latest_session/subagents/"*.meta.json 2>/dev/null |
      xargs -I{} grep -ril "$ROLE" {} 2>/dev/null
  )"
  if [[ -n "$matches" ]]; then
    while IFS= read -r meta; do
      [[ -z "$meta" ]] && continue
      transcript="${meta%.meta.json}.jsonl"
      desc="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("description",""))' "$meta" 2>/dev/null)"
      turns="$(grep -c '"type":"assistant"' "$transcript" 2>/dev/null || echo 0)"
      # Whether it DELIVERED matters more than how long it ran. "No report
      # arrived" and "it never ran" look identical from the orchestrator's seat,
      # and mistaking the first for the second is what triggers a duplicate spawn.
      state="$(python3 - "$transcript" 2>/dev/null <<'PYEOF' || echo "unknown"
import json, sys
groups, order = {}, []
for line in open(sys.argv[1]):
    try: rec = json.loads(line)
    except Exception: continue
    if rec.get("type") != "assistant": continue
    msg = rec.get("message") or {}
    if not msg.get("usage"): continue
    key = msg.get("id")
    if key not in groups:
        groups[key] = []; order.append(key)
    groups[key].append(msg)
if not order:
    print("empty"); raise SystemExit
final = groups[order[-1]]
blocks = [b.get("type") for m in final for b in (m.get("content") or []) if isinstance(b, dict)]
out = max((m.get("usage") or {}).get("output_tokens", 0) for m in final)
if blocks and blocks[-1] == "tool_use":
    print("MID-FLIGHT (died during a tool call, no report)")
elif not out:
    print("TRUNCATED (final message cut off, no report)")
else:
    print(f"delivered a report ({out} output tokens)")
PYEOF
)"
      echo "!! $(basename "$transcript")  turns~$turns  $state"
      echo "     \"$desc\""
    done <<<"$matches"
    echo "!! Prior transcript(s) exist. Inspect before spawning:"
    echo "   ./scripts/measure-agent-tokens.py '$latest_session'"
    found=1
  else
    echo "none"
  fi
fi

echo
if (( found )); then
  echo "RESULT: prior work found — resume or salvage it, do NOT spawn a replacement."
  exit 3
fi
echo "RESULT: clear to spawn."
exit 0
