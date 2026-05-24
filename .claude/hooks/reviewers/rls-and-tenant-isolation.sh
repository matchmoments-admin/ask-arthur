#!/usr/bin/env bash
# .claude/hooks/reviewers/rls-and-tenant-isolation.sh
# Flags `createServiceClient` (service-role; bypasses RLS) in files that should
# honour the user's session. See packages/supabase/CLAUDE.md "Critical rule"
# for the full policy and rationale.
#
# **Allowed callers (skip silently):**
#   - apps/web/app/api/**     (worker / B2B / cron / inngest / public-report
#                              tiers; tenant isolation is via api_key_id,
#                              cron schedule, or no-tenant report shapes)
#   - packages/scam-engine/** (durable Inngest workers)
#   - packages/supabase/**    (the factory itself)
#   - pipeline/scrapers/**    (Python; separate reviewer handles those)
#
# **Flagged callers** (anywhere else .ts/.tsx with `createServiceClient`):
#   - .tsx files (pages, layouts, server components)
#   - apps/web/middleware.ts
#   - apps/web/lib/**         (request-context utilities)
#   - packages/* outside the allowed two
#
# Output: markdown advisory block to stdout. Silent if no violation.
# Budget: ≤1s. Pure grep.

set -uo pipefail

file="$1"
rel="$2"
[ -r "$file" ] || exit 0

# Only operate on TypeScript / TSX files.
case "$rel" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

# Skip allowed (worker-tier) paths.
case "$rel" in
  apps/web/app/api/*|packages/scam-engine/*|packages/supabase/*)
    exit 0
    ;;
esac

findings=()

if grep -qE "createServiceClient" "$file" 2>/dev/null; then
  hits="$(grep -nE "createServiceClient" "$file" 2>/dev/null | head -5 || true)"

  evidence=""
  if [ -n "$hits" ]; then
    evidence="$(printf '%s' "$hits" | sed -e 's/^/    /')
"
  fi

  findings+=("**BLOCK_RECOMMENDED** — \`createServiceClient\` used outside the worker / B2B / cron tier. This bypasses RLS and the user's session. The rule lives in [packages/supabase/CLAUDE.md](../../packages/supabase/CLAUDE.md). Allowed tiers: \`apps/web/app/api/**\` (workers + B2B + cron + public-report endpoints), \`packages/scam-engine/\`, \`packages/supabase/\`, \`pipeline/scrapers/\`. If this is a legitimate request-context caller, use \`createServerClient\` (RLS-bearing) instead. Sample lines:
${evidence}")
fi

# --- Emit ------------------------------------------------------------------
if [ ${#findings[@]} -eq 0 ]; then
  exit 0
fi

printf '## rls-and-tenant-isolation-reviewer\n\n'
for f in "${findings[@]}"; do
  printf -- '- %s\n' "$f"
done
exit 0
