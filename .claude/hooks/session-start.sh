#!/usr/bin/env bash
# .claude/hooks/session-start.sh
# SessionStart hook for Claude Code on the web.
#
# Installs the workspace dependencies needed for `pnpm turbo lint typecheck
# test build` and the Python scraper tests to run in a remote sandbox.
# Local sessions are skipped (developers manage their own installs).
#
# Idempotent: safe to re-run. The container state is cached after the hook
# completes, so subsequent sessions reuse node_modules / pip cache.

set -euo pipefail

# Only run inside Claude Code on the web; local devs skip.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

echo "[session-start] installing JS workspace deps via pnpm…"
# Prefer `install` over `install --frozen-lockfile` so the cached layer can
# be reused across small lockfile drifts. Skip pnpm's interactive prompts.
pnpm install --prefer-offline --reporter=append-only

if [ -f pipeline/scrapers/requirements.txt ]; then
  echo "[session-start] installing Python scraper deps…"
  python3 -m pip install --quiet --disable-pip-version-check \
    -r pipeline/scrapers/requirements.txt
fi

echo "[session-start] done."
