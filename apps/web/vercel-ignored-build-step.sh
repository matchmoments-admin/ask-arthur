#!/usr/bin/env bash
# Vercel Ignored Build Step — exit 0 SKIPS the build, exit 1 RUNS it.
#
# Conservative: builds by default. Skips ONLY when 100% of changed files
# match the safe-to-skip allowlist. Anything that could plausibly affect
# the web bundle (apps/web/, packages/, tooling/, pnpm-lock.yaml,
# turbo.json, root package.json, env files) triggers a build.
#
# Vercel runs this from the repository root regardless of the project's
# Root Directory setting:
#   https://vercel.com/docs/projects/git/monorepos#ignored-build-step
#
# To disable: remove the "ignoreCommand" line from apps/web/vercel.json.

set -e

PREV_SHA="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^1}"
DIFF=$(git diff --name-only "$PREV_SHA" HEAD 2>/dev/null || echo "")

# Safety net: if we can't compute a diff (force push, shallow clone,
# first deploy on this branch), always build.
if [ -z "$DIFF" ]; then
  echo "Cannot determine diff vs $PREV_SHA — building (safe default)"
  exit 1
fi

# Allowlist: every changed file must match one of these patterns for the
# commit to qualify as safe-to-skip. The web bundle is unaffected by
# anything that matches.
SAFE_REGEX='^(docs/|pipeline/|supabase/[^/]+\.sql$|supabase/\.temp/|\.github/workflows/|.*\.md$|BACKLOG\.md$|ROADMAP\.md$|SECURITY\.md$|CONTEXT\.md$|CLAUDE\.md$|CONVENTIONS\.md$|DESIGN_SYSTEM\.md$)'

while IFS= read -r file; do
  [ -z "$file" ] && continue
  if ! [[ "$file" =~ $SAFE_REGEX ]]; then
    echo "Building — '$file' is not in the safe-to-skip allowlist"
    exit 1
  fi
done <<< "$DIFF"

FILE_COUNT=$(echo "$DIFF" | wc -l | tr -d ' ')
echo "Skipping — all $FILE_COUNT changed files match safe-to-skip allowlist:"
echo "$DIFF" | sed 's/^/  /'
exit 0
