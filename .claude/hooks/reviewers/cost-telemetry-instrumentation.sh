#!/usr/bin/env bash
# .claude/hooks/reviewers/cost-telemetry-instrumentation.sh
# Flags edits that add paid-API client invocations without nearby cost
# instrumentation.
#
# Scope: apps/web/app/api/**/*.ts only. The `logCost()` helper lives at
# apps/web/lib/cost-telemetry.ts and is imported uniformly in this tree.
# Other packages (packages/scam-engine, pipeline/scrapers) use varied
# patterns (PRICING duplication to avoid an apps/web dep cycle, Inngest-
# step accounting, Python supabase-py writes) — flagging them produces
# too many false positives. The cost-telemetry-auditor agent
# (`.claude/agents/cost-telemetry-auditor.md`) is the right surface for
# those packages.
#
# Output: markdown advisory block to stdout. Silent if all checks pass.
# Sources: CLAUDE.md Critical Rules + apps/web/lib/cost-telemetry.ts
# canonical pattern.
#
# Budget: ≤2s. Pure grep.

set -uo pipefail

file="$1"
rel="$2"
[ -r "$file" ] || exit 0

# Only operate on TypeScript files under apps/web/app/api/**.
case "$rel" in
  apps/web/app/api/*.ts|apps/web/app/api/**/*.ts) ;;
  *) exit 0 ;;
esac

findings=()

# Paid-API signals: imports and fetch URLs we know cost money. Keep this list
# in sync with apps/web/lib/cost-telemetry.ts `PRICING` constants.
PAID_IMPORTS_RE='(@anthropic-ai/sdk|resend|twilio|@vonage|apivoid|ipqualityscore|abuseipdb|virustotal|haveibeenpwned|urlscan|@aws-sdk/client-s3)'
PAID_FETCH_RE='(api\.anthropic\.com|api\.resend\.com|api\.twilio\.com|rest\.nexmo\.com|endpoint\.apivoid\.com|ipqualityscore\.com|api\.abuseipdb\.com|virustotal\.com|api\.pwnedpasswords\.com|haveibeenpwned\.com|urlscan\.io|googleapis\.com/safebrowsing)'

# Does the file reference a paid API at all?
has_paid_signal=0
if grep -qE "from[[:space:]]+['\"]${PAID_IMPORTS_RE}" "$file" 2>/dev/null \
   || grep -qE "${PAID_FETCH_RE}" "$file" 2>/dev/null; then
  has_paid_signal=1
fi

[ "$has_paid_signal" -eq 0 ] && exit 0

# Does the file (or the route's nearby _helpers.ts) reference cost instrumentation?
has_cost_signal=0
if grep -qE "(logCost|cost-telemetry|cost_telemetry|feature_brakes)" "$file" 2>/dev/null; then
  has_cost_signal=1
fi

if [ "$has_cost_signal" -eq 1 ]; then
  exit 0
fi

# Collect the offending lines for the advisory.
paid_lines="$(grep -nE "from[[:space:]]+['\"]${PAID_IMPORTS_RE}" "$file" 2>/dev/null || true)"
fetch_lines="$(grep -nE "${PAID_FETCH_RE}" "$file" 2>/dev/null || true)"

evidence=""
if [ -n "$paid_lines" ]; then
  evidence="${evidence}$(printf '%s' "$paid_lines" | head -3 | sed -e 's/^/    /')
"
fi
if [ -n "$fetch_lines" ]; then
  evidence="${evidence}$(printf '%s' "$fetch_lines" | head -3 | sed -e 's/^/    /')
"
fi

findings+=("**ADVISORY** — paid-API client used in this file without any \`logCost\` / \`cost-telemetry\` / \`feature_brakes\` reference. CLAUDE.md Critical Rules: every paid call site must tag spend (so it shows in \`/admin/costs\` + the weekly Telegram digest) and respect the relevant \`feature_brakes\` row. Reference pattern: \`apps/web/lib/cost-telemetry.ts:112\` \`logCost()\` import. Sample lines:
${evidence}")

# --- Emit ------------------------------------------------------------------
if [ ${#findings[@]} -eq 0 ]; then
  exit 0
fi

printf '## cost-telemetry-instrumentation-reviewer\n\n'
for f in "${findings[@]}"; do
  printf -- '- %s\n' "$f"
done
exit 0
