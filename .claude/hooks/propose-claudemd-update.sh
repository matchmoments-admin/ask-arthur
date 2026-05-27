#!/usr/bin/env bash
# .claude/hooks/propose-claudemd-update.sh
# Stop hook — advisory only. Examines the session's git activity and, if the
# session contains a `fix(...)` / `correct` follow-up commit, proposes that a
# rule might belong in the nearest subdirectory CLAUDE.md.
#
# Does NOT write to disk. Emits the proposal via the top-level `systemMessage`
# field (the only schema-valid surface for Stop hooks; `hookSpecificOutput` is
# reserved for PreToolUse / UserPromptSubmit / PostToolUse / PostToolBatch).
# The runtime renders systemMessage in the chat so the human / model can
# decide whether to promote the proposal into a real rule.
#
# **Critical:** checks the `stop_hook_active` JSON field first and exits 0
# immediately if true (prevents infinite Stop loops, per the official Claude
# Code hooks spec).
#
# Budget: ≤2s. Pure shell + python3 for JSON parse.

set -uo pipefail

input="$(cat 2>/dev/null || echo '{}')"

# Parse stop_hook_active + last_assistant_message in a single python3 call.
parsed="$(printf '%s' "$input" \
  | python3 -c 'import json,sys
try:
  d = json.load(sys.stdin)
  print("1" if d.get("stop_hook_active") else "0")
  print(d.get("last_assistant_message","")[:500])
except Exception:
  print("0")
  print("")' 2>/dev/null || printf '0\n\n')"
stop_active="$(printf '%s\n' "$parsed" | sed -n '1p')"

# Guard against infinite Stop loops.
[ "$stop_active" = "1" ] && exit 0

# Only run inside a git repo.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Look at the session's commit list. We approximate "this session" as commits
# since origin/main (or main if origin isn't fetched). A `fix(` or `correct`
# token in any of those commits is the trigger.
session_log="$(git log --pretty=format:'%H%x09%s' origin/main..HEAD 2>/dev/null \
  || git log --pretty=format:'%H%x09%s' main..HEAD 2>/dev/null \
  || true)"

[ -z "$session_log" ] && exit 0

trigger_commit=""
while IFS=$'\t' read -r sha subject; do
  if printf '%s' "$subject" | grep -qiE "(^|[^[:alpha:]])(fix|correct)(\(|: |ing |ed )"; then
    trigger_commit="$sha"
    break
  fi
done <<< "$session_log"

[ -z "$trigger_commit" ] && exit 0

# Find the most-touched subdirectory among the session's changes — that's the
# best candidate to host a new rule.
top_dir="$(git diff --name-only origin/main..HEAD 2>/dev/null \
  | grep -E '^(apps|packages|pipeline|supabase)/[^/]+' \
  | awk -F/ '{print $1"/"$2}' \
  | sort | uniq -c | sort -rn | awk 'NR==1{print $2}')"

[ -z "$top_dir" ] && exit 0

# Does the candidate already have a sub-CLAUDE.md? If not, propose creating one.
candidate_claudemd="${top_dir}/CLAUDE.md"
if [ -f "$candidate_claudemd" ]; then
  proposal="Consider adding a new rule to \`${candidate_claudemd}\` capturing the lesson from the fix commit (\`${trigger_commit:0:7}\`). The session touched \`${top_dir}\` repeatedly and shipped a corrective commit — a rule there could prevent a repeat."
else
  proposal="Consider creating \`${candidate_claudemd}\` modelled on the existing sub-CLAUDE.md pattern (5 sections: owns / doesn't own / public API / gotchas / where things live). The session touched \`${top_dir}\` repeatedly and shipped a fix commit (\`${trigger_commit:0:7}\`) — local guidance could prevent a repeat."
fi

# Emit the advisory as top-level `systemMessage` (the only valid Stop-hook
# field for surfacing text — `hookSpecificOutput.additionalContext` is for
# UserPromptSubmit / PostToolUse / PostToolBatch, NOT Stop).
printf '%s\n' "$proposal" | python3 -c 'import json,sys; print(json.dumps({"systemMessage": sys.stdin.read().rstrip("\n")}))'
exit 0
