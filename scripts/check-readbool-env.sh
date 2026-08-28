#!/usr/bin/env bash
# Fail CI when server-side boolean env vars are read with the literal
# `process.env.X === "true"` pattern instead of the `readBoolEnv()` helper.
#
# This is CLAUDE.md "Never Do" #7 -- the only Never-Do rule with TWO documented
# production failures and, until 2026-08-28, nothing enforcing it. Map #978
# flagged it (backlog tail rank 19); remediation: issue #1047.
#
# The two failure modes it guards, both real:
#   1. A trailing newline in the Vercel-stored value. "true\n" is not === "true",
#      so the flag reads false and the feature is silently dark.
#   2. Next.js / Webpack DefinePlugin statically inlines `process.env.X` member
#      accesses at BUILD time. A var not visible to the build (an encrypted
#      secret, a late-added var) gets baked in as `undefined` forever.
# `readBoolEnv()` (packages/utils/src/env.ts) trims AND uses bracket notation
# with a variable key, which defeats both.
#
# WHY THIS IS A SCRIPT AND NOT AN ESLINT RULE
# Only apps/web is linted. Sixteen of the seventeen workspaces have no eslint
# config and no lint script, and the root flat config explicitly ignores
# `apps/**` and `packages/**`. A lint rule would cover apps/web and READ as
# covering the monorepo -- precisely the "control that looks like protection
# and is not" class this check was written to end. A grep over the whole tree
# needs no per-package wiring and cannot silently lose coverage.
#
# A companion eslint rule was considered and deliberately NOT added: it would
# duplicate this gate for one workspace, add a second thing to maintain, and
# invite the reading that lint covers the rule everywhere. One gate, whole
# tree, tested. The underlying lint-coverage gap is a finding in its own right
# and belongs to its own decision, not to this check.
#
# Tests: scripts/tests/check-readbool-env.test.sh -- both directions.

set -euo pipefail
cd "$(dirname "$0")/.."

# NEXT_PUBLIC_* is the deliberate exception: the client bundle has no
# `process.env` at runtime and relies on exactly this build-time inlining.
# See the header of packages/utils/src/feature-flags.ts.
#
# grep -E has no negative lookahead, so match broadly then filter.
BROAD='process\.env\.[A-Za-z_][A-Za-z0-9_]*[[:space:]]*[!=]==?[[:space:]]*["'"'"'](true|1)["'"'"']'

# Build-time configs that run on the build machine and inline the result into a
# client bundle -- the same exception NEXT_PUBLIC_* gets, for the same reason.
# Keep this list SHORT and justify every entry.
ALLOWLIST_RE='^apps/extension/wxt\.config\.ts$'

hits="$(
  grep -rInE "$BROAD" \
    --include='*.ts' --include='*.tsx' \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist \
    --exclude-dir=.turbo --exclude-dir=build --exclude-dir=worktrees \
    apps packages 2>/dev/null \
  | grep -v 'process\.env\.NEXT_PUBLIC_' \
  | awk -F: -v allow="$ALLOWLIST_RE" '$1 !~ allow' \
  || true
)"

if [ -n "$hits" ]; then
  echo "::error::Literal boolean env reads found. Use readBoolEnv() from @askarthur/utils/env."
  printf '%s\n' "$hits" | sed 's/^/  /'
  echo "::error::CLAUDE.md Never-Do #7. Two production failures: a trailing newline in the stored value, and DefinePlugin baking the var in as undefined. NEXT_PUBLIC_* is exempt (client bundles need the inlining)."
  exit 1
fi

scanned="$(grep -rIl --include='*.ts' --include='*.tsx' \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist \
  --exclude-dir=.turbo --exclude-dir=build --exclude-dir=worktrees \
  'process\.env' apps packages 2>/dev/null | wc -l | tr -d ' ')"
echo "readBoolEnv usage OK (${scanned} files reference process.env; NEXT_PUBLIC_* exempt; allowlisted: apps/extension/wxt.config.ts)"
