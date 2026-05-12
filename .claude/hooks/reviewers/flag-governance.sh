#!/usr/bin/env bash
# .claude/hooks/reviewers/flag-governance.sh
# Checks Critical Rules for additions / changes in
# packages/utils/src/feature-flags.ts.
#
# Output: markdown advisory block to stdout. Silent if all checks pass.
# Sources: CLAUDE.md Critical Rules ("Before flipping any consumer feature
# flag from default-OFF to ON") + docs/system-map/feature-flags.md
# convention (NEXT_PUBLIC_FF_* vs FF_*) + cost-brake naming.
#
# Budget: ≤2s. Pure grep.

set -uo pipefail

file="$1"
rel="$2"
[ -r "$file" ] || exit 0

findings=()

# --- 1. Default ON consumer flag (suspicious) ------------------------------
# Consumer flags should default OFF. We can't easily detect a "consumer" flag
# vs an internal one without semantic context, but we can flag ANY new
# default-true assignment that the user might want to second-guess.
default_on_lines="$(grep -nE "^[[:space:]]*[a-zA-Z][a-zA-Z0-9_]*:[[:space:]]*(true|process\.env\.[A-Z_]+[[:space:]]*===?[[:space:]]*['\"](true|1)['\"][[:space:]]*\|\|[[:space:]]*true)" "$file" 2>/dev/null || true)"
if [ -n "$default_on_lines" ]; then
  count="$(printf '%s\n' "$default_on_lines" | wc -l | tr -d ' ')"
  findings+=("**ADVISORY** — ${count} flag line(s) default to \`true\`. CLAUDE.md Critical Rules require new consumer features to ship default-OFF. Confirm each \`true\` default is either zero-cost / always-on (like \`emailSecurityChecks\`) or has explicit operator authorisation. See \`docs/system-map/feature-flags.md\` for current default state per flag.")
fi

# --- 2. Bare cost-brake number rule ----------------------------------------
# CLAUDE.md "Per-feature cost brakes": use bare numbers (5, 10) — non-numeric
# values silently disable the brake because parseFloat("$10") is NaN.
# Flag any cost-brake env var with quotes around the value.
bad_brake="$(grep -nE "_CAP_USD[^=]*=[[:space:]]*['\"]" "$file" 2>/dev/null || true)"
if [ -n "$bad_brake" ]; then
  findings+=("**BLOCK_RECOMMENDED** — cost-brake env var with quoted value found. CLAUDE.md Critical Rules: use bare numbers (\`5\`, \`10\`). Quotes / dollar signs / non-numeric values silently disable the brake because \`parseFloat(\"\$10\")\` is \`NaN\`.")
fi

# --- 3. Consumer flag without NEXT_PUBLIC_ prefix on client-visible name --
# Heuristic: if the flag NAME ends in something clearly consumer-facing
# (Public, Consumer, Dashboard, Email, Pages) we'd expect NEXT_PUBLIC_FF_*
# env binding. This is a loose check.
consumer_pattern="(public|consumer|dashboard|email|pages|widget|alert)"
if grep -qiE "\"?[A-Za-z]*(${consumer_pattern}):" "$file" 2>/dev/null; then
  # Are there any FF_* env reads WITHOUT NEXT_PUBLIC_ prefix that match?
  if grep -qE "process\.env\.FF_[A-Z_]*(PUBLIC|CONSUMER|DASHBOARD|EMAIL|PAGES|WIDGET|ALERT)" "$file" 2>/dev/null; then
    findings+=("**ADVISORY** — found server-only \`FF_*\` env var name that looks consumer-facing. Consumer flags should use \`NEXT_PUBLIC_FF_*\` so the client bundle can read them. Confirm whether this flag actually needs to be hidden from the client.")
  fi
fi

# --- 4. New flag without entry in docs/system-map/feature-flags.md --------
# Detect added flag lines (heuristic: any line ending in a property assignment
# inside an object) and warn the user to update the system map. We can't do
# a real diff in a hook, so this is a general reminder.
findings+=("**REMINDER** — if this change adds or removes a flag, update [\`docs/system-map/feature-flags.md\`](../../docs/system-map/feature-flags.md) in the same PR. Single home per fact (per the system-map convention). And before flipping any consumer flag OFF → ON in prod, re-run \`mcp__supabase__get_advisors\` + the Disk-IO-budget query.")

# --- Emit ------------------------------------------------------------------
if [ ${#findings[@]} -eq 0 ]; then
  exit 0
fi

printf '## flag-governance-reviewer\n\n'
for f in "${findings[@]}"; do
  printf -- '- %s\n' "$f"
done
exit 0
