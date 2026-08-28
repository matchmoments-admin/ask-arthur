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
# This guard runs on EVERY history-writing git command (NOT session-gated) and
# blocks:
#   A. any command that would write history on main / master  -> exit 2
#   B. `git commit` while the index looks WIPED (HEAD has files, index has 0)
#      -> exit 2. This is the "entire repo staged for deletion" failure mode
#      seen 2026-05-29 (concurrent git access emptied .git/index); committing
#      then would record a whole-tree deletion.
#
# Born from two git-state incidents on 2026-05-29 (commit-on-main + index wipe).
#
# --- 2026-08-28 rewrite (audit: issue #1046, remediation: issue #1053) -------
# The previous version tested `case "$cmd" in *"git commit"*|*"git push"*`.
# A go-red harness proved it blocked the two obvious cases and let four others
# through:
#
#   git<space><space>commit             two spaces defeated the literal match
#   git merge / revert / cherry-pick    produce commits; matched no string
#   git checkout main && git commit     branch read BEFORE the command ran
#   git -C <other-repo> commit          branch read from the WRONG repo
#
# ...and blocked one safe pattern it exists to encourage:
#
#   git checkout -b feat/x && git commit    blocked though it branches first
#
# The fix replaces string-matching with a small model of what the command
# actually does: sanitise (drop heredoc bodies and quoted text so example
# commands inside a string are not mistaken for real ones), resolve which
# repository is being written to (`git -C`), walk the command's segments in
# order tracking the branch each one leaves us on, and block if a
# history-writing verb lands on a protected branch.
#
# The sanitisation step is load-bearing and was itself found by testing: the
# first version of this rewrite blocked the very commit that introduced its own
# test file, because the file's heredoc contains `git checkout main && git
# commit` as test DATA. Writing about a banned command is not performing it —
# the same distinction the db-migration reviewer needed for comments.
#
# Tests: .claude/hooks/tests/git-commit-guard.test.sh — both directions, run in
# CI on every PR.

set -uo pipefail

PROTECTED_RE='^(main|master)$'
# Verbs that write history. `push` is included because pushing from a protected
# branch is the other half of the same mistake.
WRITE_VERBS_RE='^(commit|merge|revert|cherry-pick|rebase|am|push)$'

input="$(cat 2>/dev/null || echo '{}')"

# Cheap pre-filter: no mention of git at all means nothing to guard. Kept so
# the common case never pays for a python parse.
case "$input" in
  *git*) : ;;
  *) exit 0 ;;
esac

# Parse and sanitise in one python pass. Emits two lines:
#   1. the raw command, whitespace-normalised   (used to resolve `git -C <path>`)
#   2. the sanitised command                    (used to walk verbs)
parsed="$(printf '%s' "$input" | python3 -c '
import json, re, sys

try:
    d = json.load(sys.stdin)
    cmd = (d.get("tool_input") or {}).get("command", "") or ""
except Exception:
    print(); print(); sys.exit(0)

# 1. Drop heredoc bodies. A heredoc is data, not commands: a test fixture or a
#    doc block may legitimately contain `git commit` as an example.
lines = cmd.split("\n")
out, i = [], 0
heredoc_re = re.compile(r"<<-?\s*[\x27\x22]?([A-Za-z_][A-Za-z0-9_]*)[\x27\x22]?")
while i < len(lines):
    line = lines[i]
    m = heredoc_re.search(line)
    out.append(heredoc_re.sub("", line) if m else line)
    if m:
        marker, i = m.group(1), i + 1
        while i < len(lines) and lines[i].strip() != marker:
            i += 1
    i += 1
body = "\n".join(out)

# 2. Replace quoted spans with a placeholder. A real verb is never inside
#    quotes; a commit message or an echoed example often is. Kept as a token
#    rather than deleted so token positions still line up.
quoted = re.sub(r"\x27[^\x27]*\x27|\x22[^\x22]*\x22", " Q ", body)

norm = re.sub(r"\s+", " ", body).strip()
scan = re.sub(r"\s+", " ", quoted).strip()
print(norm)
print(scan)
' 2>/dev/null || printf '\n\n')"

norm="$(printf '%s' "$parsed" | sed -n '1p')"
scan="$(printf '%s' "$parsed" | sed -n '2p')"

[ -z "$scan" ] && exit 0
case " $scan " in *" git "*) : ;; *) exit 0 ;; esac

# --- Which repository is being written to? ----------------------------------
# `git -C <path> commit` writes to <path>, not the working directory. Reading
# the branch from the wrong repo is how the old guard was bypassed.
repo_dir="."
if printf '%s' "$norm" | grep -qE '(^| )git -C '; then
  repo_dir="$(printf '%s' "$norm" | sed -nE 's/.*(^| )git -C ([^ ]+).*/\2/p' | head -1)"
  repo_dir="${repo_dir%\"}"; repo_dir="${repo_dir#\"}"
  repo_dir="${repo_dir%\'}"; repo_dir="${repo_dir#\'}"
  [ -n "$repo_dir" ] || repo_dir="."
fi

git -C "$repo_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
branch="$(git -C "$repo_dir" branch --show-current 2>/dev/null || echo "")"

# --- Walk the command in order, tracking the branch it leaves us on ---------
# A single Bash call can switch branch and then commit. The old guard read the
# branch once, before any of it ran, so `git checkout main && git commit` was
# invisible to it. Splitting on the shell's sequencing operators and replaying
# the branch changes in order catches that -- and, in the other direction,
# stops the guard blocking `git checkout -b feat/x && git commit`, which is the
# safe pattern it exists to encourage.
effective="$branch"
verb_on_protected=""
commit_verb_seen=""

segments="$(printf '%s' "$scan" | sed 's/&&/\n/g; s/||/\n/g; s/;/\n/g; s/|/\n/g')"

while IFS= read -r seg; do
  seg="$(printf '%s' "$seg" | sed -E 's/^ +//; s/ +$//')"
  [ -z "$seg" ] && continue

  # Strip a leading `git -C <path>` so the verb is the next token either way.
  bare="$(printf '%s' "$seg" | sed -E 's/^git -C [^ ]+ /git /')"
  case "$bare" in "git "*) : ;; *) continue ;; esac

  verb="$(printf '%s' "$bare" | awk '{print $2}')"
  rest="$(printf '%s' "$bare" | cut -d' ' -f3-)"

  # Branch-changing verbs update where we are.
  if [ "$verb" = "checkout" ] || [ "$verb" = "switch" ]; then
    if printf '%s' "$rest" | grep -qE '(^| )-[a-zA-Z]*[bBcC]( |$)'; then
      # Creating a new branch -- we land somewhere that is not protected.
      effective="$(printf '%s' "$rest" | sed -nE 's/.*(^| )-[a-zA-Z]*[bBcC] ([^ ]+).*/\2/p' | head -1)"
      [ -z "$effective" ] && effective="__new__"
    else
      target="$(printf '%s' "$rest" | awk '{for (i = 1; i <= NF; i++) if ($i !~ /^-/) { print $i; exit }}')"
      [ -n "$target" ] && effective="$target"
    fi
    continue
  fi

  if printf '%s' "$verb" | grep -qE "$WRITE_VERBS_RE"; then
    [ "$verb" = "commit" ] && commit_verb_seen="yes"
    if printf '%s' "$effective" | grep -qE "$PROTECTED_RE"; then
      verb_on_protected="$verb"
    fi
  fi
done <<SEGMENTS
$segments
SEGMENTS

# --- Guard A: never write history on a protected branch ---------------------
if [ -n "$verb_on_protected" ]; then
  cat >&2 <<MSG
[git-guard] Blocked: \`git $verb_on_protected\` would write history on the
protected branch \`$effective\` (repo: $repo_dir).

CLAUDE.md ship workflow: never commit, merge, revert or push directly to
$effective. Cut/checkout a feature branch first:

  git checkout -b <scope>/<short-task-name>

(This guard runs on EVERY history-writing git command -- unlike
branch-check.sh, which only checks once per session on the first Edit --
because the branch pointer can move mid-session, including inside this very
command.)
MSG
  exit 2
fi

# --- Guard B: refuse to commit a wiped index ---------------------------------
if [ -n "$commit_verb_seen" ]; then
  head_files="$(git -C "$repo_dir" ls-tree -r HEAD --name-only 2>/dev/null | wc -l | tr -d ' ')"
  index_files="$(git -C "$repo_dir" ls-files 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${head_files:-0}" -gt 50 ] && [ "${index_files:-0}" -eq 0 ]; then
    cat >&2 <<MSG
[git-guard] Blocked: the git index looks WIPED -- HEAD has $head_files files
but the index has 0. Committing now would record a deletion of the entire tree.

This is the 2026-05-29 index-corruption failure mode (concurrent git access
emptied .git/index). Recover -- rebuilds the index from HEAD, leaves your
working tree untouched:

  git reset --mixed HEAD

Then re-check \`git status\` before committing.
MSG
    exit 2
  fi
fi

exit 0
