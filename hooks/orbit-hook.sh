#!/bin/sh
# Forwards Claude Code hook events to Orbit.
# Never blocks Claude: the event is read, then sent in the background while the hook returns at once (PostToolUse
# fires on every tool step); short timeout, errors are swallowed, exit code is always 0.

ORBIT_URL="${ORBIT_URL:-http://127.0.0.1:4747}"
ORBIT_HOME="${ORBIT_HOME:-$HOME/.orbit}"
DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
# The server writes this token on start; without it the request is rejected (ADR-0009).
TOKEN=$(cat "$ORBIT_HOME/hook-token" 2>/dev/null)
BODY=$(cat)

(
  # One git call: the main repo's .git (same from a worktree) and the top of the checkout we are in (ADR-0017).
  GIT=$(git -C "$DIR" rev-parse --path-format=absolute --git-common-dir --show-toplevel 2>/dev/null)
  GIT_COMMON=$(printf '%s\n' "$GIT" | sed -n 1p)
  GIT_TOP=$(printf '%s\n' "$GIT" | sed -n 2p)
  BRANCH=$(git -C "$DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)
  printf '%s' "$BODY" | curl -s -m 2 -o /dev/null -X POST "$ORBIT_URL/events" \
    -H "Content-Type: application/json" \
    -H "X-Orbit-Token: $TOKEN" \
    -H "X-Orbit-Git-Common: $GIT_COMMON" \
    -H "X-Orbit-Git-Top: $GIT_TOP" \
    -H "X-Orbit-Branch: $BRANCH" \
    --data-binary @-
) >/dev/null 2>&1 </dev/null &

exit 0
