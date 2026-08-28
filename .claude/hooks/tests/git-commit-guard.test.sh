#!/usr/bin/env bash
# Go-red / go-green tests for .claude/hooks/git-commit-guard.sh.
#
# Why this file exists: before 2026-08-28 neither direction of this guard had
# ever been demonstrated. It had never blocked anything in anger and had never
# been shown capable of blocking. A control that has never failed has never
# been tested -- the promptfoo workflow made that point expensively (green 24
# times out of 24 having never run an eval). Audit: issue #1046.
#
# Runs in CI on every PR (.github/workflows/ci.yml). Pure bash + git, no deps.
#
# Each case builds a throwaway repository, puts it on a known branch, feeds the
# guard a PreToolUse payload, and asserts the exit code:
#   exit 2 = blocked, exit 0 = allowed.

set -uo pipefail

GUARD="$(cd "$(dirname "$0")/.." && pwd)/git-commit-guard.sh"
[ -x "$GUARD" ] || { echo "FATAL: $GUARD not executable"; exit 1; }

TMPROOT="$(mktemp -d -t git-guard-tests.XXXXXX)"
trap 'rm -rf "$TMPROOT"' EXIT

pass=0
fail=0
n=0

# make_repo <dir-name> <branch> [wipe-index]
make_repo() {
  local dir="$TMPROOT/$1"
  mkdir -p "$dir" || return 1
  cd "$dir" || return 1
  git init -q -b main . >/dev/null 2>&1
  git config user.email test@example.com >/dev/null 2>&1
  git config user.name test >/dev/null 2>&1
  local i
  for i in $(seq 1 60); do echo x > "f$i.txt"; done
  git add -A >/dev/null 2>&1
  git commit -qm init >/dev/null 2>&1
  if [ "$2" != "main" ]; then
    git checkout -qb "$2" >/dev/null 2>&1
  fi
  if [ "${3:-}" = "wipe-index" ]; then
    git rm -q --cached -r . >/dev/null 2>&1
  fi
}

# check <branch> <BLOCK|ALLOW> <description> <command>
check() {
  local branch="$1" expected="$2" desc="$3" command="$4"
  n=$((n + 1))
  make_repo "r$n" "$branch" >/dev/null 2>&1
  local payload rc actual
  payload="$(python3 -c 'import json,sys; print(json.dumps({"tool_input": {"command": sys.argv[1]}}))' "$command")"
  printf '%s' "$payload" | bash "$GUARD" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq 2 ]; then actual="BLOCK"; else actual="ALLOW"; fi
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1))
    printf '  ok   [%-5s] %s\n' "$actual" "$desc"
  else
    fail=$((fail + 1))
    printf '  FAIL [got %s, want %s] %s\n         cmd: %s\n' "$actual" "$expected" "$desc" "$command"
  fi
}

echo "git-commit-guard -- go-red (must block)"
check main BLOCK "commit on main"                          "git commit -m wip"
check main BLOCK "push from main"                          "git push origin main"
check main BLOCK "commit on main with collapsed whitespace" "git   commit -m wip"
check main BLOCK "merge on main"                           "git merge --no-ff other"
check main BLOCK "revert on main"                          "git revert HEAD"
check main BLOCK "cherry-pick on main"                     "git cherry-pick abc123"
check main BLOCK "rebase on main"                          "git rebase other"
check feat BLOCK "checkout main mid-command, then commit"  "git checkout main && git commit -m wip"
check feat BLOCK "switch main mid-command, then commit"    "git switch main && git commit -m wip"
check feat BLOCK "slow step, then switch to main, then commit" "pnpm lint && git switch main && git commit -m wip"

echo "git-commit-guard -- go-green (must allow)"
check feat ALLOW "commit on a feature branch"              "git commit -m wip"
check feat ALLOW "push from a feature branch"              "git push -u origin feat"
check main ALLOW "branch first, then commit (checkout -b)" "git checkout -b feat/x && git commit -m wip"
check main ALLOW "branch first, then commit (switch -c)"   "git switch -c feat/x && git commit -m wip"
check main ALLOW "ship-workflow step 1: sync main"         "git fetch origin && git checkout main && git pull --ff-only"
check feat ALLOW "non-git command"                         "echo hello"
check feat ALLOW "read-only git"                           "git status"
check feat ALLOW "a quoted string that mentions committing on main" "echo 'git checkout main && git commit is blocked'"

echo "git-commit-guard -- git -C targets the other repository's branch"
# The old guard read the branch from the working directory no matter which
# repository the command wrote to, so `git -C <repo-on-main> commit` walked
# straight past it -- and .claude/settings.local.json allowlists commands of
# exactly that shape, including a push to main.
make_repo "cminus_main" "main" >/dev/null 2>&1
OTHER_MAIN="$TMPROOT/cminus_main"
make_repo "cminus_feat" "feat" >/dev/null 2>&1
OTHER_FEAT="$TMPROOT/cminus_feat"
make_repo "cminus_cwd" "feat" >/dev/null 2>&1   # cwd sits on a feature branch

cminus() {
  local target="$1" expected="$2" desc="$3"
  local payload rc actual
  n=$((n + 1))
  cd "$TMPROOT/cminus_cwd" || return 1
  payload="$(python3 -c 'import json,sys; print(json.dumps({"tool_input": {"command": "git -C " + sys.argv[1] + " commit -m wip"}}))' "$target")"
  printf '%s' "$payload" | bash "$GUARD" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq 2 ]; then actual="BLOCK"; else actual="ALLOW"; fi
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1))
    printf '  ok   [%-5s] %s\n' "$actual" "$desc"
  else
    fail=$((fail + 1))
    printf '  FAIL [got %s, want %s] %s\n' "$actual" "$expected" "$desc"
  fi
}

cminus "$OTHER_MAIN" BLOCK "git -C <repo on main> commit, from a feature-branch cwd"
cminus "$OTHER_FEAT" ALLOW "git -C <repo on a feature branch> commit"

echo "git-commit-guard -- guard B (wiped index)"
n=$((n + 1))
make_repo "wiped" "feat" "wipe-index" >/dev/null 2>&1
printf '%s' '{"tool_input":{"command":"git commit -m wip"}}' | bash "$GUARD" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 2 ]; then
  pass=$((pass + 1))
  echo "  ok   [BLOCK] commit against a wiped index"
else
  fail=$((fail + 1))
  echo "  FAIL [got ALLOW, want BLOCK] commit against a wiped index"
fi

echo
echo "git-commit-guard: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
