#!/usr/bin/env bash
# .claude/hooks/branch-check.sh
# PreToolUse hook for Edit|Write|MultiEdit|NotebookEdit.
#
# Enforces the CLAUDE.md "Standard ship workflow" rule:
#   "Start every new piece of work on a fresh branch off main. Do NOT piggyback
#    on someone else's feature branch."
#
# Runs once per Claude Code session (gated by /tmp/.claude-branch-checked-<sid>).
# Blocks (exit 2) on:
#   1. main / master            — must branch off main first.
#   2. inherited feature branch — branch has commits ahead of origin/main but
#      the tip commit is not by the current git user.
# Otherwise: writes the marker and allows the edit.
#
# Override (rare, when you really mean it): touch the marker file shown in the
# error message, or run the same Edit again after deleting the rule's premise.

set -uo pipefail

# Best-effort stdin parse — Claude Code sends a JSON payload with session_id
# and the tool's parameters under tool_input. We grab both in a single python
# call: session_id (for the per-session marker) and the target file path
# (Write/Edit/MultiEdit -> file_path; NotebookEdit -> notebook_path).
input="$(cat 2>/dev/null || echo '{}')"
parsed="$(printf '%s' "$input" \
  | python3 -c 'import json,sys
try:
  d = json.load(sys.stdin)
  ti = d.get("tool_input") or {}
  print(d.get("session_id",""))
  print(ti.get("file_path") or ti.get("notebook_path") or "")
except Exception:
  print("")
  print("")' 2>/dev/null || printf '\n\n')"
session_id="$(printf '%s\n' "$parsed" | sed -n '1p')"
target="$(printf '%s\n' "$parsed" | sed -n '2p')"
session_id="${session_id:-default}"

marker="/tmp/.claude-branch-checked-${session_id}"

# Already checked this session? Allow without re-running.
if [ -f "$marker" ]; then
  exit 0
fi

# Target is outside the project root? The branch is irrelevant for files that
# can't be committed (e.g. ~/.claude/plans/, /tmp/, other repos). Only enforce
# when the path is absolute AND inside $CLAUDE_PROJECT_DIR; unknown/relative
# paths fall through to the git checks (safe default).
if [ -n "$target" ] && [[ "$target" == /* ]]; then
  project_root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
  project_root="${project_root%/}"
  if [[ "$target" != "$project_root" && "$target" != "$project_root/"* ]]; then
    exit 0
  fi
fi

# Not in a git repo (e.g. plain workspace)? Nothing to enforce.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  touch "$marker"
  exit 0
fi

branch="$(git branch --show-current 2>/dev/null || echo "")"

# Detached HEAD or unknown — don't block, but flag.
if [ -z "$branch" ]; then
  touch "$marker"
  exit 0
fi

# --- Rule 1: never edit while sitting on main/master --------------------------
if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  cat <<EOF >&2
[branch-check] Edit blocked: you are on \`$branch\`.

CLAUDE.md "Standard ship workflow" requires a fresh branch off main before any
code change:

  git fetch origin && git checkout main && git pull --ff-only
  git checkout -b <scope>/<short-task-name>

If you intentionally need to edit on $branch (rare), override once:
  touch "$marker"
EOF
  exit 2
fi

# --- Rule 2: detect "inherited" or stale-from-previous-session branches -------
# CLAUDE.md says to verify the branch before continuing on it. The strict rule:
# any commits ahead of origin/main require explicit confirmation per session.
# Pick a base ref. Prefer origin/main (most accurate); fall back to main.
base=""
if git rev-parse --verify --quiet origin/main >/dev/null; then
  base="origin/main"
elif git rev-parse --verify --quiet main >/dev/null; then
  base="main"
fi

if [ -n "$base" ]; then
  ahead="$(git rev-list --count "HEAD" "^$base" 2>/dev/null || echo 0)"
  if [ "$ahead" -gt 0 ]; then
    me="$(git config user.email 2>/dev/null || echo "")"
    last_author="$(git log -1 --format=%ae HEAD 2>/dev/null || echo "")"
    last_ts="$(git log -1 --format=%ct HEAD 2>/dev/null || echo 0)"
    last_subject="$(git log -1 --format=%s HEAD 2>/dev/null || echo "")"
    age_h=$(( ( $(date +%s) - last_ts ) / 3600 ))
    if [ "$me" = "$last_author" ]; then
      who="you ($me)"
    else
      who="$last_author"
    fi
    cat <<EOF >&2
[branch-check] Edit paused: branch \`$branch\` already has $ahead commit(s) ahead of $base.

  tip author : $who
  tip age    : ${age_h}h
  tip subject: $last_subject

CLAUDE.md "Standard ship workflow" requires verifying the branch before
continuing — don't piggyback on someone else's branch, and don't auto-resume an
inherited branch from a previous session.

If this is genuinely the right branch for the task, confirm once per session:

  touch "$marker"

Otherwise cut a fresh branch off main:

  git fetch origin && git checkout main && git pull --ff-only
  git checkout -b <scope>/<short-task-name>
EOF
    exit 2
  fi
fi

# All checks passed — record and proceed.
touch "$marker"
exit 0
