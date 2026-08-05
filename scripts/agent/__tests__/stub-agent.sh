#!/usr/bin/env bash
# Stub orchestrator for the outer-loop tests (spec §8 Tier 0).
#
# Substituted for the real spawn via AGENT_CMD, so every loop mechanic —
# sequencing, ceilings, kill-resume, bounce budget, the learnings-on-exit gate —
# is exercised for zero tokens. Behaviour is driven by STUB_MODE:
#
#   commit          record all three roles green, commit, write learnings, exit 0
#   commit-silent   same but write NO learnings (must trip the FR-A4.2 gate)
#   bounce          record a validator bounce and exit without committing
#   block           mark the unit blocked and exit
#   hang            sleep forever (must trip the ceiling)
#   dirty-hang      leave an uncommitted file, then sleep forever
#   crash           exit non-zero having done nothing
#
#   $1 = unit id, $2 = repo root

set -uo pipefail

UNIT="$1"
ROOT="$2"
MODE="${STUB_MODE:-commit}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RATCHET="node $SCRIPT_DIR/ratchet.mjs"
export AGENT_ROOT="$ROOT"

record_learnings() {
  $RATCHET learn --unit "$UNIT" --role orchestrator --kind strength \
    --evidence "Directive named src/core/schedule.ts:42 and AC-25.3 for $UNIT" \
    --action "Keep naming the seam file:line in implementer directives"
  $RATCHET learn --unit "$UNIT" --role validator --kind weakness \
    --evidence "Validator re-read src/core/guardrails.ts:88 that the report already summarised" \
    --action "Put the implementer's summary in the validator brief"
}

case "$MODE" in
  commit | commit-silent)
    for role in implementer validator reviewer; do
      $RATCHET record-role "$UNIT" "$role" --outcome green --note "stub $role"
    done
    echo "stub work for $UNIT" >>"$ROOT/stub-work.txt"
    git -C "$ROOT" add -A
    git -C "$ROOT" -c user.email=stub@example.com -c user.name=Stub \
      commit -q -m "feat: $UNIT (stub)"
    sha="$(git -C "$ROOT" rev-parse HEAD)"
    $RATCHET set-status "$UNIT" committed --sha "$sha"
    [[ "$MODE" == "commit" ]] && record_learnings
    exit 0
    ;;

  bounce)
    $RATCHET record-role "$UNIT" implementer --outcome green --note "stub"
    $RATCHET record-role "$UNIT" validator --outcome bounced --note "test cannot fail"
    $RATCHET bounce "$UNIT" --reason "validator: the new test passes against the old code"
    exit 0
    ;;

  block)
    $RATCHET set-status "$UNIT" blocked --reason "needs a product decision on the default"
    exit 0
    ;;

  hang)
    sleep 600
    ;;

  dirty-hang)
    echo "half-applied fix" >"$ROOT/half-done.ts"
    sleep 600
    ;;

  crash)
    exit 9
    ;;

  *)
    echo "unknown STUB_MODE: $MODE" >&2
    exit 2
    ;;
esac
