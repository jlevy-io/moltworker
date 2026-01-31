#!/bin/bash
# Prevents Claude Code from committing directly to main.
# This is a PreToolUse hook that intercepts Bash commands.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Check if this is a git commit command
if echo "$COMMAND" | grep -qE "git\s+commit"; then
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

  if [ "$CURRENT_BRANCH" = "main" ]; then
    echo "BLOCKED: Cannot commit directly to main. Create a feature branch first (git checkout -b <branch-name>)." >&2
    exit 2
  fi
fi

# Also block git push to main (catches force pushes and direct pushes)
if echo "$COMMAND" | grep -qE "git\s+push.*\bmain\b"; then
  echo "BLOCKED: Cannot push directly to main. Push to a feature branch and open a PR." >&2
  exit 2
fi

exit 0
