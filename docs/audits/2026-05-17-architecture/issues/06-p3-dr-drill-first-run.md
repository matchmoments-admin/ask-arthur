---
severity: P3
title: "[P3] First quarterly DR drill on 2026-07-01 — author apps/web/scripts/smoke.ts"
labels: severity:p3, ready-for-human, domain:dr, ops
action_type: code + ops
estimated_time: ~2 hours
---

## Summary

The DR plan calls for quarterly drills (1 Jul, 1 Oct, 1 Jan, 1 Apr) that restore the nightly `pg_dump` artifact to a sibling Supabase project and run smoke tests. The first drill is scheduled for **2026-07-01** but two prerequisites are missing:

1. The R2 DR bucket isn't yet configured (issue #02) — there's nothing to restore _from_.
2. `apps/web/scripts/smoke.ts` doesn't exist yet — there's nothing to _run against_ the restored DB.

This issue covers (2).

**Blocked by:** issue #02

## Impact

Without a smoke-test harness, the drill becomes "did the restore command return 0?" which doesn't verify the restored data is queryable. Real disaster scenarios surface as schema mismatches and broken RPCs, not failed `pg_restore` exits.

## Fix

Author `apps/web/scripts/smoke.ts` (Node 22, TSX-runnable) that, given a `SUPABASE_URL` + service-role key:

1. **Schema sanity:**
   - `mcp__supabase__list_tables` → confirm count ≥75
   - `mcp__supabase__list_migrations` → confirm last migration matches expected version
2. **Table-level row counts:**
   - SELECT count from `scam_reports`, `feed_items`, `acnc_charities`, `verified_scams` — must be > some threshold
3. **RPC smoke:**
   - Call `match_scam_reports_hybrid('test scam', dummy-embed, 5)` → expect non-empty array
   - Call `search_charities('red cross', 5)` → expect at least 1 row
   - Call `check_breach_exposure('test@example.com')` → expect a numeric response (even if zero)
4. **Trigger sanity:**
   - Insert a row into `auth.users` (via service-role) → confirm trigger creates a `user_profiles` row
   - Rollback the insert
5. **Output:**
   - Plain-text pass/fail summary
   - Non-zero exit on any failure

Document in `docs/ops/dr-drill-runbook.md`:

- Restore steps (assumes R2 → fresh Supabase project)
- `tsx apps/web/scripts/smoke.ts --url=<restored>` invocation
- Where to file the drill report (issue comment + ops log)

## Verification

- `tsx apps/web/scripts/smoke.ts --url=$PRIMARY_SUPABASE_URL` passes against current prod (sanity check before drill)
- Calendar reminder set for 2026-07-01 + 14 days head start

## Publish

```bash
gh issue create \
  --repo matchmoments-admin/ask-arthur \
  --title "[P3] First quarterly DR drill on 2026-07-01 — author apps/web/scripts/smoke.ts" \
  --label "severity:p3,ready-for-human,domain:dr,ops" \
  --body-file 06-p3-dr-drill-first-run.md
```
