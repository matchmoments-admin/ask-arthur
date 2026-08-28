#!/usr/bin/env bash
# Go-red / go-green tests for scripts/check-readbool-env.sh.
#
# A check that has never failed has never been tested. This one guards
# CLAUDE.md Never-Do #7, whose whole point is that the failure is SILENT --
# a flag reads false and the feature is dark, with nothing raised anywhere.
# So the go-red direction matters more here than usual: if the check cannot
# fail, it reproduces the exact failure mode it exists to prevent.
#
# Runs in CI on every PR (.github/workflows/ci.yml).

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK="$ROOT/scripts/check-readbool-env.sh"
[ -x "$CHECK" ] || { echo "FATAL: $CHECK not executable"; exit 1; }

# Fixtures live inside the tree because the check scans apps/ and packages/ by
# design -- a temp directory elsewhere would not be seen. The trap removes them
# on every exit path, including failure.
FIXTURE_DIR="$ROOT/packages/utils/src/__readbool_fixture__"
trap 'rm -rf "$FIXTURE_DIR"' EXIT
rm -rf "$FIXTURE_DIR"
mkdir -p "$FIXTURE_DIR"

pass=0
fail=0

# expect <0|1> <description>
expect() {
  local want="$1" desc="$2" rc
  "$CHECK" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq "$want" ]; then
    pass=$((pass + 1))
    printf '  ok   [exit %d] %s\n' "$rc" "$desc"
  else
    fail=$((fail + 1))
    printf '  FAIL [exit %d, want %d] %s\n' "$rc" "$want" "$desc"
  fi
}

echo "check-readbool-env"

rm -f "$FIXTURE_DIR"/*.ts
expect 0 "clean tree passes"

cat > "$FIXTURE_DIR/violation.ts" <<'TS'
export const enabled = process.env.FF_SOMETHING === "true";
TS
expect 1 "a literal server-flag read fails the check"

rm -f "$FIXTURE_DIR"/*.ts
cat > "$FIXTURE_DIR/violation_bang.ts" <<'TS'
export const disabled = process.env.FF_SOMETHING !== "true";
TS
expect 1 "the negated form fails too"

rm -f "$FIXTURE_DIR"/*.ts
cat > "$FIXTURE_DIR/violation_one.ts" <<'TS'
export const enabled = process.env.FF_SOMETHING === "1";
TS
expect 1 "the \"1\" spelling fails too"

rm -f "$FIXTURE_DIR"/*.ts
cat > "$FIXTURE_DIR/public_ok.ts" <<'TS'
export const enabled = process.env.NEXT_PUBLIC_FF_SOMETHING === "true";
TS
expect 0 "NEXT_PUBLIC_* is exempt (client bundles need build-time inlining)"

rm -f "$FIXTURE_DIR"/*.ts
cat > "$FIXTURE_DIR/helper_ok.ts" <<'TS'
import { readBoolEnv } from "../env";
export const enabled = readBoolEnv("FF_SOMETHING");
TS
expect 0 "readBoolEnv() is the sanctioned form"

rm -f "$FIXTURE_DIR"/*.ts
cat > "$FIXTURE_DIR/nodeenv_ok.ts" <<'TS'
export const isProd = process.env.NODE_ENV === "production";
TS
expect 0 "NODE_ENV === \"production\" is not a boolean flag read"

echo
echo "check-readbool-env: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
