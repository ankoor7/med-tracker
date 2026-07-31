#!/usr/bin/env bash
# The outer loop (FR-A4.1). Spawns one ephemeral orchestrator per unit until the
# ratchet says there is nothing eligible left.
#
#   ./scripts/agent-run.sh [--ceiling-seconds N] [--max-spawns N] [--dry-run]
#
# There is deliberately no model in this loop. Deciding *whether* to continue is a
# question about recorded state, so it costs no context to answer — which is the
# whole reason the resident orchestrator (48.6% of baseline run cost, cache
# write:read 1:4) is replaced by a script plus short-lived spawns.
#
# The loop owns three things a model was previously trusted to remember:
#   1. the wall-clock ceiling (FR-A4.3) — a hung tool call is indistinguishable
#      from a slow subagent from the inside, so a monitor that holds no context
#      watches instead, and one measured 409-minute hang becomes one ceiling;
#   2. the event log (FR-A4.4) — every spawn accounted for, at zero context cost;
#   3. the learnings-on-exit gate (FR-A4.2) — an orchestrator whose context is
#      destroyed at exit cannot write its learnings later, so exiting without
#      them is treated as a failure, not a success.
#
# Testing hook: AGENT_CMD replaces the orchestrator spawn, which is how the whole
# loop is exercised for zero tokens (spec §8 Tier 0). It receives the unit id as
# $1 and the repo root as $2.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${AGENT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
export AGENT_ROOT="$REPO_ROOT"
RATCHET="node $SCRIPT_DIR/agent/ratchet.mjs"

CEILING_SECONDS="${AGENT_CEILING_SECONDS:-5400}" # 90 min: three role agents plus margin
MAX_SPAWNS="${AGENT_MAX_SPAWNS:-40}"             # runaway backstop, not a work limit
BOUNCE_BUDGET="${AGENT_BOUNCE_BUDGET:-3}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ceiling-seconds) CEILING_SECONDS="$2"; shift 2 ;;
    --max-spawns) MAX_SPAWNS="$2"; shift 2 ;;
    --bounce-budget) BOUNCE_BUDGET="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

log() { printf '[loop] %s\n' "$*"; }
event() { $RATCHET event --kind "$1" --unit "${2:-}" ${3:+--extra "$3"}; }

# --- portable ceiling -------------------------------------------------------
# No timeout(1) on macOS, and gtimeout is not guaranteed. Background the child,
# poll cheaply, kill the whole process group on breach. Returns 124 on timeout,
# matching timeout(1)'s convention so callers can branch on it.
run_with_ceiling() {
  local seconds="$1"; shift
  set -m
  "$@" &
  local child=$!
  set +m
  local waited=0
  while kill -0 "$child" 2>/dev/null; do
    if (( waited >= seconds )); then
      # Kill the group: an orchestrator's own subagents must not outlive it.
      kill -TERM "-$child" 2>/dev/null || kill -TERM "$child" 2>/dev/null
      sleep 1
      kill -KILL "-$child" 2>/dev/null || kill -KILL "$child" 2>/dev/null
      wait "$child" 2>/dev/null
      return 124
    fi
    sleep 1
    waited=$(( waited + 1 ))
  done
  wait "$child"
  return $?
}

# --- environment coherence (FR-A4.3) ---------------------------------------
# After a kill, the tree may hold a half-applied fix or a leftover mutation from
# a validator that died mid-revert. Say so loudly; the successor's preflight
# decides what to do about it.
check_tree_coherent() {
  local dirty
  dirty="$(git -C "$REPO_ROOT" status --porcelain -- ':(exclude).agent' 2>/dev/null)"
  if [[ -n "$dirty" ]]; then
    log "tree has uncommitted code after the kill:"
    printf '%s\n' "$dirty" | sed 's/^/       /'
    return 1
  fi
  return 0
}

spawn_orchestrator() {
  local unit="$1"
  if [[ -n "${AGENT_CMD:-}" ]]; then
    # shellcheck disable=SC2086
    run_with_ceiling "$CEILING_SECONDS" bash -c "$AGENT_CMD \"\$1\" \"\$2\"" _ "$unit" "$REPO_ROOT"
    return $?
  fi

  # The real spawn. One unit, cold start, exit — the prompt says nothing about
  # what to build, because that is in the spec and the ratchet.
  local prompt
  prompt="You are an ephemeral orchestrator for ONE unit of work: $unit.

1. Run ./scripts/agent-bootstrap.sh $unit and read docs/agent-protocol.md.
2. Run ./scripts/agent-preflight.sh <role> $unit before EVERY role spawn. Exit 3
   means prior work exists: resume it, never spawn a replacement.
3. Drive the Implement -> Validate -> Review cycle for $unit only. Record each
   role's outcome with: pnpm agent:ratchet record-role $unit <role> --outcome ...
4. Commit the unit (one unit, one commit), then:
   pnpm agent:ratchet set-status $unit committed --sha <sha>
5. Before exiting, append at least one strength-class and one weakness-class
   learning for this unit with: pnpm agent:ratchet learn ...
   Your context is destroyed at exit; an unwritten learning is lost forever.
6. Exit. Do NOT start the next unit — the loop handles that.

If a decision is the user's, record it and mark the unit blocked:
  pnpm agent:ratchet set-status $unit blocked --reason '...'
Do not ask permission to continue; continuing is the default."

  run_with_ceiling "$CEILING_SECONDS" claude -p "$prompt" \
    --append-system-prompt "$(cat "$REPO_ROOT/docs/agent-protocol.md" 2>/dev/null)"
  return $?
}

# --- learnings-on-exit gate (FR-A4.2) --------------------------------------
learnings_written() {
  $RATCHET learnings-ok "$1" >/dev/null 2>&1
}

json_field() {
  printf '%s' "$1" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s)[process.argv[1]]??"")}catch{console.log("")}})' "$2"
}

# --- main loop --------------------------------------------------------------
if [[ ! -f "$REPO_ROOT/.agent/units.json" ]]; then
  echo "no .agent/units.json in $REPO_ROOT — run \`pnpm agent:ratchet init\` first" >&2
  exit 2
fi

log "ceiling=${CEILING_SECONDS}s max-spawns=$MAX_SPAWNS bounce-budget=$BOUNCE_BUDGET"
event run-started "" "{\"ceiling_seconds\":$CEILING_SECONDS}"

spawns=0
while :; do
  next_json="$($RATCHET next --json 2>/dev/null)"
  next_status=$?
  if (( next_status == 6 )) || [[ -z "$next_json" ]]; then
    log "nothing eligible remains"
    break
  fi

  unit="$(json_field "$next_json" unit)"
  kind="$(json_field "$next_json" kind)"
  if [[ -z "$unit" || "$kind" == "none" || "$kind" == "done" ]]; then
    log "nothing eligible remains"
    break
  fi

  # Bounce budget (FR-A4.6): stop grinding, hand it to a human with the evidence.
  bounces="$($RATCHET unit-field "$unit" bounce_count 2>/dev/null || echo 0)"
  bounces="${bounces:-0}"
  if (( bounces >= BOUNCE_BUDGET )); then
    log "$unit hit the bounce budget ($bounces) — blocking it for review"
    $RATCHET set-status "$unit" blocked --reason "bounce budget exhausted after $bounces attempts"
    event bounce-budget-exhausted "$unit" "{\"bounces\":$bounces}"
    continue
  fi

  if (( spawns >= MAX_SPAWNS )); then
    log "hit max-spawns ($MAX_SPAWNS) — stopping to avoid a runaway loop"
    event max-spawns-reached "$unit"
    break
  fi

  if (( DRY_RUN )); then
    log "dry-run: would spawn for $unit ($kind)"
    break
  fi

  spawns=$(( spawns + 1 ))
  log "spawn #$spawns for $unit ($kind)"
  event spawned "$unit" "{\"spawn\":$spawns,\"action\":\"$kind\"}"

  started=$SECONDS
  spawn_orchestrator "$unit"
  exit_status=$?
  elapsed=$(( SECONDS - started ))

  if (( exit_status == 124 )); then
    log "CEILING BREACH after ${elapsed}s — killed the spawn for $unit"
    event ceiling-breach "$unit" "{\"elapsed_seconds\":$elapsed}"
    if check_tree_coherent; then
      log "tree is coherent; the successor will resume $unit via preflight"
    else
      log "tree is NOT coherent — the successor must salvage before continuing"
      event tree-incoherent "$unit"
    fi
    continue
  fi

  event exited "$unit" "{\"status\":$exit_status,\"elapsed_seconds\":$elapsed}"

  if (( exit_status != 0 )); then
    log "spawn for $unit exited $exit_status"
  fi

  # Enforce the exit obligation. A committed unit with no learnings is the
  # failure mode this stage introduces and must not be allowed to pass quietly.
  unit_status="$($RATCHET unit-field "$unit" status 2>/dev/null || echo unknown)"

  if [[ "$unit_status" == "committed" ]] && ! learnings_written "$unit"; then
    log "!! $unit is committed but has no two-sided learnings — treating as a breach (FR-A4.2)"
    event learnings-missing "$unit"
  fi

  if [[ "$unit_status" == "blocked" ]]; then
    log "$unit is blocked — moving on to whatever else is eligible"
    event user-escalation "$unit"
  fi
done

event run-finished "" "{\"spawns\":$spawns}"
log "run finished after $spawns spawn(s)"

# The run report is the primary artifact a human reads afterwards (FR-A4.7).
node "$SCRIPT_DIR/agent/run-report.mjs" --digest > "$REPO_ROOT/.agent/run-digest.md" 2>/dev/null &&
  log "wrote .agent/run-digest.md — feed it to the synthesis pass (pnpm agent:report)"

$RATCHET status
exit 0
