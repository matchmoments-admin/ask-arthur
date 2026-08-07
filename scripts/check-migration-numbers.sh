#!/usr/bin/env bash
# Tier 3 item 12 (wayfinder #903), static half: fail CI when two migration
# files claim the same version number. This exact class shipped twice —
# v261 was claimed by two files in parallel sessions (one renumbered to
# v264 after the fact), and the numbers on the GRANDFATHERED list below were
# reused historically. The prod-ledger/schema diff half needs credentials
# and is tracked separately; THIS check needs none and runs on every PR.
set -euo pipefail
cd "$(dirname "$0")/.."

# Applied history is immutable (supabase/CLAUDE.md rule 1): these duplicate
# numbers already shipped and their files must never be renamed. Anything
# NOT on this list that duplicates is a new defect. Do not add to this list.
GRANDFATHERED="^(10|11|100)$"

dupes=$(ls supabase/migration-v*.sql \
  | sed -E 's|.*/migration-v([0-9]+)[-.].*|\1|' \
  | sort -n | uniq -d \
  | grep -Ev "$GRANDFATHERED" || true)

if [ -n "$dupes" ]; then
  echo "::error::Duplicate migration version number(s): $(echo "$dupes" | tr '\n' ' ')"
  for d in $dupes; do ls supabase/migration-v"$d"[-.]*.sql 2>/dev/null || true; done
  echo "::error::Two files claiming one version is how the v261/v264 collision shipped. Renumber the newer file to max+1."
  exit 1
fi
echo "migration numbering OK ($(ls supabase/migration-v*.sql | wc -l | tr -d ' ') files; grandfathered historical dupes: v10 v11 v100)"
