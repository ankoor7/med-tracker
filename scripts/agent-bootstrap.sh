#!/usr/bin/env bash
# Deterministic "where am I?" for any cold-starting agent (FR-A3.3).
#
#   ./scripts/agent-bootstrap.sh [unit]
#
# Every spawned agent runs this first. It replaces the exploratory rediscovery
# each agent used to do on its own — reading the tree, guessing whether the dev
# server is up, working out what the last session did. That discovery cost real
# tokens and produced different answers each time; this produces the same answer
# in the same order every run, which is the point: determinism in the harness
# compensates for non-determinism in the model.
#
# Output is intentionally free of timestamps and other churn, so two runs
# against an unchanged tree are byte-identical.

set -uo pipefail

# The tooling lives beside this script; the run state lives in whatever repo we
# are pointed at. Those are not the same directory — the trial protocol runs the
# loop against a separate worktree — so resolve them independently.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${AGENT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
RATCHET="node $SCRIPT_DIR/agent/ratchet.mjs"
export AGENT_ROOT="$REPO_ROOT"
AGENT_DIR="$REPO_ROOT/.agent"
UNIT="${1:-}"

# Tunable so tests and other repos can point at their own stack.
DEV_URL="${AGENT_DEV_URL:-http://localhost:5173}"
DB_URL="${AGENT_DB_URL:-http://localhost:54321/rest/v1/}"
TAIL_LINES="${AGENT_TAIL_LINES:-25}"

echo "=== AGENT BOOTSTRAP ==="
echo
echo "--- 1. Repo ---"
echo "root:   $REPO_ROOT"
echo "branch: $(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '(none)')"

echo
echo "--- 2. Run state ---"
if [[ -f "$AGENT_DIR/units.json" ]]; then
  $RATCHET status
  echo
  echo "next action:"
  # `next` decides spawn-vs-resume from recorded state, so no agent has to
  # remember what ran. Exit 6 means everything left is blocked.
  $RATCHET next || true
  if [[ -n "$UNIT" ]]; then
    echo
    echo "roles already run for $UNIT:"
    for role in implementer validator reviewer; do
      echo "  $role: $($RATCHET role-state "$UNIT" "$role" 2>/dev/null || echo '{"outcome":"never-ran"}')"
    done
  fi
else
  echo "no .agent/units.json — this run has no ratchet yet (see specs/agent/agent-stage-3-state-ratchet.md)"
fi

echo
echo "--- 3. Recent commits ---"
git -C "$REPO_ROOT" log --oneline -5 2>/dev/null || echo "(no commits)"

echo
echo "--- 4. Working tree ---"
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]]; then
  git -C "$REPO_ROOT" status --short
else
  echo "clean"
fi
if [[ -n "$(git -C "$REPO_ROOT" stash list 2>/dev/null)" ]]; then
  echo "stashes:"
  git -C "$REPO_ROOT" stash list
fi

echo
echo "--- 5. Environment ---"
if [[ "${AGENT_SKIP_ENV:-}" == "1" ]]; then
  echo "dev server: (skipped)"
  echo "database:   (skipped)"
else
  if curl -fsS -o /dev/null --max-time 2 "$DEV_URL" 2>/dev/null; then
    echo "dev server: up ($DEV_URL)"
  else
    echo "dev server: DOWN ($DEV_URL) — start it with \`pnpm dev\` before validating"
  fi
  if curl -fsS -o /dev/null --max-time 2 "$DB_URL" 2>/dev/null; then
    echo "database:   up ($DB_URL)"
  else
    echo "database:   DOWN ($DB_URL) — \`pnpm local:up\` if this unit needs the backend"
  fi
fi

echo
echo "--- 6. Failed approaches (do not retry these) ---"
if [[ -f "$AGENT_DIR/failed-approaches.md" ]]; then
  tail -n "$TAIL_LINES" "$AGENT_DIR/failed-approaches.md"
else
  echo "(none recorded)"
fi

echo
echo "--- 7. Recent learnings ---"
if [[ -f "$AGENT_DIR/learnings.jsonl" ]]; then
  tail -n 8 "$AGENT_DIR/learnings.jsonl"
else
  echo "(none recorded)"
fi

echo
echo "=== END BOOTSTRAP ==="
