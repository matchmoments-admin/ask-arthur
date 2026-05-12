#!/usr/bin/env bash
# .claude/hooks/reviewers/cron-impact.sh
# Checks Critical Rules for new/modified Vercel crons + Inngest functions.
# Invoked by run-reviewer.sh PostToolUse when the edited file is under
# apps/web/app/api/cron/**, apps/web/vercel.json, or
# packages/scam-engine/src/inngest/**.
#
# Output: markdown advisory block to stdout. Silent if all checks pass.
# Sources: CLAUDE.md Critical Rules ("For any new Inngest function or Vercel
# /api/cron/* route" — 5-min budget, chunking on hot tables, pg-stuck-query-
# watchdog interaction) + docs/system-map/background-workers.md.
#
# Budget: ≤3s. Pure grep / awk.

set -uo pipefail

file="$1"
rel="$2"
[ -r "$file" ] || exit 0

findings=()

HOT_TABLES_RE='acnc_charities|scam_reports|verified_scams|feedback_triage_queue|feed_items|scam_entities'

# --- 1. vercel.json: a new cron entry should declare a sensible schedule ---
case "$rel" in
  apps/web/vercel.json)
    # Look for any cron schedule that runs more frequently than every 5 min
    # outside the pg-stuck-query-watchdog (which is intentionally */5).
    # `*/N` where N < 5 is suspect.
    suspicious="$(grep -nE '"schedule":[[:space:]]*"\*/[1-4][[:space:]]\*' "$file" 2>/dev/null || true)"
    if [ -n "$suspicious" ]; then
      findings+=("**ADVISORY** — found cron schedule(s) more frequent than every 5 minutes. Confirm the work fits in the budget and that you're not duplicating the \`pg-stuck-query-watchdog\` (\`*/5\`). See docs/system-map/background-workers.md for the existing timetable.")
    fi
    findings+=("**REMINDER** — any new cron route must verify the Vercel cron signature (\`x-vercel-cron-secret\` / \`x-vercel-idempotency-id\`). See existing routes under \`apps/web/app/api/cron/\` for the pattern.")
    ;;
esac

# --- 2. apps/web/app/api/cron/<name>/route.ts: check budget hints ----------
case "$rel" in
  apps/web/app/api/cron/*)
    # If the route reads/writes a hot table, require chunking signal
    if grep -qiE "from[[:space:]]*\(?\s*['\"](${HOT_TABLES_RE})['\"]" "$file" 2>/dev/null \
       || grep -qiE "\.from\(['\"](${HOT_TABLES_RE})['\"]" "$file" 2>/dev/null; then
      if ! grep -qiE "(chunk|batch|limit\(|\.limit\(|range\(|paginate)" "$file" 2>/dev/null; then
        findings+=("**ADVISORY** — this cron route touches a hot table (\`${HOT_TABLES_RE}\`) but I don't see chunking/batching/pagination signals. CLAUDE.md requires <5-min completion on a healthy DB; anything that could exceed 10 min will trigger \`pg-stuck-query-watchdog\`. Chunk or document the expected duration in the route header.")
      fi
    fi
    # Require Vercel cron signature verification
    if ! grep -qiE "(x-vercel-cron|CRON_SECRET|verifyCron|vercelCron)" "$file" 2>/dev/null; then
      findings+=("**ADVISORY** — cron route should verify the Vercel cron signature (\`x-vercel-cron-secret\` header) before executing. Otherwise the endpoint is publicly invokable.")
    fi
    ;;
esac

# --- 3. packages/scam-engine/src/inngest/**: check cron + hot-table -------
case "$rel" in
  packages/scam-engine/src/inngest/*)
    # Look for cron triggers
    if grep -qiE "(cron[:=]|\"cron\")" "$file" 2>/dev/null; then
      # If the function reads/writes a hot table, require chunking signal
      if grep -qiE "['\"](${HOT_TABLES_RE})['\"]" "$file" 2>/dev/null; then
        if ! grep -qiE "(chunk|batch|limit\(|\.limit\(|range\(|paginate|step\.run)" "$file" 2>/dev/null; then
          findings+=("**ADVISORY** — this Inngest function appears to be cron-triggered AND touches a hot table (\`${HOT_TABLES_RE}\`). Chunk the work at ≤5K rows per iteration, OR wrap in \`step.run\` so Inngest can checkpoint between chunks. Without this, exceeding 10 min pages \`pg-stuck-query-watchdog\`. See docs/system-map/background-workers.md for the chunked pattern.")
        fi
      fi
      # Require concurrency cap (or document why none)
      if ! grep -qiE "concurrency[[:space:]]*:" "$file" 2>/dev/null; then
        findings+=("**ADVISORY** — this Inngest function has no explicit \`concurrency:\` cap. Without it, a backlog can saturate the Inngest plan limit (5 concurrent on current plan). Set explicitly to document intent.")
      fi
    fi
    # Check for idempotency key on event-triggered functions
    if grep -qiE "(event[:=]|\"event\")" "$file" 2>/dev/null \
       && ! grep -qiE "idempotency[[:space:]]*:" "$file" 2>/dev/null; then
      findings+=("**ADVISORY** — event-triggered Inngest function with no \`idempotency:\` key. CLAUDE.md ship-workflow assumes \`event.data.requestId\` is the dedup key. Set explicitly.")
    fi
    ;;
esac

# --- Emit ------------------------------------------------------------------
if [ ${#findings[@]} -eq 0 ]; then
  exit 0
fi

printf '## cron-impact-reviewer\n\n'
for f in "${findings[@]}"; do
  printf -- '- %s\n' "$f"
done
exit 0
