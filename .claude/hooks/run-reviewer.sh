#!/usr/bin/env bash
# .claude/hooks/run-reviewer.sh
# PostToolUse dispatcher for Edit|Write|MultiEdit|NotebookEdit.
#
# Decides which reviewer(s) apply based on the edited file's path, runs them,
# and emits a single combined advisory block to stdout. The advisory surfaces
# inline in the next assistant turn so Claude (and the user) sees the warning
# before the change ships.
#
# All reviewers are **advisory** (exit 0 unconditionally) and **read-only**.
# They do not block the edit. They check the Critical Rules in CLAUDE.md +
# ADRs in docs/adr/ + the deployed-surface map in docs/system-map/.
#
# Budget: ≤5s total wall-clock per reviewer. Pure shell (grep, cat, find).
# No LLM invocation; no network. Per-reviewer matchers are narrow path globs.
#
# Composes cleanly with the existing PreToolUse branch-check.sh because:
#   - This runs on PostToolUse (different event)
#   - Each reviewer self-gates on file path; unrelated edits cost ~50ms total
#   - Output goes to stdout (advisory), not stderr (would imply error)

set -uo pipefail

input="$(cat 2>/dev/null || echo '{}')"
file_path="$(printf '%s' "$input" \
  | python3 -c 'import json,sys
try:
  d = json.load(sys.stdin)
  ti = d.get("tool_input") or {}
  print(ti.get("file_path") or ti.get("notebook_path") or "")
except Exception:
  print("")' 2>/dev/null || printf '')"

# Empty path — nothing to review.
[ -z "$file_path" ] && exit 0

# Normalise to project-relative path (best-effort).
project_root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
project_root="${project_root%/}"
rel_path="${file_path#$project_root/}"

reviewers_dir="${project_root}/.claude/hooks/reviewers"
[ -d "$reviewers_dir" ] || exit 0

# Decide which reviewer(s) apply. Match on relative path prefix / suffix.
applicable=()

# db-migration-reviewer:
#   - supabase/migrations/**
#   - pipeline/scrapers/**   (post-incident 2026-05-09: scrapers can take down
#                              the site via hot-table updates)
case "$rel_path" in
  supabase/migrations/*|pipeline/scrapers/*)
    applicable+=("db-migration")
    ;;
esac

# cron-impact-reviewer:
#   - apps/web/app/api/cron/**
#   - apps/web/vercel.json
#   - packages/scam-engine/src/inngest/**
case "$rel_path" in
  apps/web/app/api/cron/*|apps/web/vercel.json|packages/scam-engine/src/inngest/*)
    applicable+=("cron-impact")
    ;;
esac

# flag-governance-reviewer:
#   - packages/utils/src/feature-flags.ts (exact)
if [ "$rel_path" = "packages/utils/src/feature-flags.ts" ]; then
  applicable+=("flag-governance")
fi

# cost-telemetry-instrumentation-reviewer:
#   - apps/web/app/api/** (any .ts file under the API tree; * matches '/')
case "$rel_path" in
  apps/web/app/api/*.ts)
    applicable+=("cost-telemetry-instrumentation")
    ;;
esac

# rls-and-tenant-isolation-reviewer:
#   - apps/web/** + packages/** (.ts / .tsx)
#   - reviewer self-skips allowed worker-tier paths (scam-engine, inngest fns, supabase pkg)
case "$rel_path" in
  apps/web/*.ts|apps/web/*.tsx|packages/*.ts|packages/*.tsx)
    applicable+=("rls-and-tenant-isolation")
    ;;
esac

# No reviewers applicable — silent exit.
[ ${#applicable[@]} -eq 0 ] && exit 0

# Run each applicable reviewer. Each emits its own header + bullet findings.
# Collect output; only emit if any reviewer produced findings.
combined=""
for name in "${applicable[@]}"; do
  script="${reviewers_dir}/${name}.sh"
  [ -x "$script" ] || continue
  out="$( "$script" "$file_path" "$rel_path" 2>/dev/null )"
  [ -n "$out" ] && combined="${combined}${out}"$'\n\n'
done

# All reviewers silent (PASS) — exit silently.
[ -z "${combined// /}" ] && exit 0

# Emit the combined advisory block.
printf '%s\n' "$combined"
exit 0
