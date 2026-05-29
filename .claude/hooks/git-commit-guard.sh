#!/usr/bin/env bash
# .claude/hooks/git-commit-guard.sh
# PreToolUse hook for the Bash tool.
#
# Closes two gaps that branch-check.sh (Edit|Write, once-per-session) can't:
#   1. branch-check.sh never runs on Bash, so `git commit` itself is unguarded.
#   2. branch-check.sh is gated by a per-session marker, so a branch pointer
#      that MOVES mid-session (concurrent agent / stray checkout) is never
#      re-checked. A commit can then land on `main`.
#
# This guard runs on EVERY commit/push (NOT session-gated) and blocks:
#   A. `git commit` / `git push` while on main / master  → exit 2
#   B. `git commit` while the index looks WIPED (HEAD has files, index has 0)
#      → exit 2. This is the "entire repo staged for deletion" failure mode
#      seen 2026-05-29 (concurrent git access emptied .git/index); committing
#      then would record a whole-tree deletion.
#
# Fast-paths every non-commit/push Bash command with exit 0 (a cheap string
# test on raw stdin BEFORE invoking python, so the common case stays fast).
#
# Born from two git-state incidents on 2026-05-29 (commit-on-main + index wipe).

set -uo pipefail

input="$(cat 2>/dev/null || echo '{}')"

# Cheap pre-filter: if the raw payload doesn't even mention a git commit/push,
# there's nothing to guard — exit before paying for a python parse.
case "$input" in
  *"git commit"* | *"git push"*) : ;;
  *) exit 0 ;;
esac

# Parse the actual command string (avoids false positives from `echo "git
# commit"` etc. — we only want the real command field).
cmd="$(printf '%s' "$input" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
    print((d.get("tool_input") or {}).get("command", ""))
except Exception:
    print("")' 2>/dev/null || echo "")"

case "$cmd" in
  *"git commit"* | *"git push"*) : ;;
  *) exit 0 ;;
esac

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
branch="$(git branch --show-current 2>/dev/null || echo "")"

# --- Guard A: never commit/push on the protected branch ----------------------
if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  cat >&2 <<EOF
[git-guard] Blocked: you are on the protected branch \`$branch\`.

CLAUDE.md ship workflow: never commit or push directly to $branch. Cut/checkout
a feature branch first:

  git checkout -b <scope>/<short-task-name>

(This guard runs on EVERY commit — unlike branch-check.sh, which only checks
once per session on the first Edit — because the branch pointer can move
mid-session. Verify \`git branch --show-current\` before committing.)
EOF
  exit 2
fi

# --- Guard B: refuse to commit a wiped index ---------------------------------
case "$cmd" in
  *"git commit"*)
    head_files="$(git ls-tree -r HEAD --name-only 2>/dev/null | wc -l | tr -d ' ')"
    index_files="$(git ls-files 2>/dev/null | wc -l | tr -d ' ')"
    if [ "${head_files:-0}" -gt 50 ] && [ "${index_files:-0}" -eq 0 ]; then
      cat >&2 <<EOF
[git-guard] Blocked: the git index looks WIPED — HEAD has $head_files files but
the index has 0. Committing now would record a deletion of the entire tree.

This is the 2026-05-29 index-corruption failure mode (concurrent git access
emptied .git/index). Recover — rebuilds the index from HEAD, leaves your
working tree untouched:

  git reset --mixed HEAD

Then re-check \`git status\` before committing.
EOF
      exit 2
    fi
    ;;
esac

exit 0
