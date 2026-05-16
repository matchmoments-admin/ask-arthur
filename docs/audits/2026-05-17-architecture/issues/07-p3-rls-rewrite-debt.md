---
severity: P3
title: "[P3] RLS rewrite debt audit on ~10 remaining tables (multi-permissive consolidation)"
labels: severity:p3, ready-for-agent, domain:db, security
action_type: code · DB migration
estimated_time: ~1 day (audit + single migration)
---

## Summary

The 2026-04-23 db-hygiene sweep flagged multi-permissive RLS policies on ~10 tables. Migrations v104 (security-definer lockdown) and v107 (multi-permissive consolidation) cleared the bulk of it; ~10 tables remain. Per BACKLOG.md → Database Hygiene & SPF Readiness.

## Impact

- **Performance:** every permissive policy runs as an additional `OR` clause in the row filter. Multiple permissive policies on a single table per role means extra eval work on every row read/write.
- **Auditability:** harder to reason about "who can do what" when the same role has 3 overlapping policies vs. 1 consolidated one.
- **No correctness bug** today — flagged as `info` not `warn` by `mcp__supabase__get_advisors`. Pure hygiene.

## Fix

1. Run `mcp__supabase__get_advisors` (type=performance) and filter to the RLS multi-permissive lints. Note: also check the linter's "advisor reasoning" output for the actual table names.
2. For each affected table:
   - Read current policies: `SELECT policyname, cmd, roles, qual, with_check FROM pg_policies WHERE tablename = '<t>'`
   - Consolidate same-role same-cmd policies into a single policy with combined `qual` (OR-merged)
   - DROP the redundants
3. Ship as a single idempotent migration `v123_rls_multi_permissive_consolidation.sql` with `DROP POLICY IF EXISTS … CREATE POLICY …` per table
4. Re-run advisor; confirm zero multi-permissive lints

## Tables to confirm in audit

Per BACKLOG.md → Database Hygiene, candidates include (not exhaustive — confirm with advisor): `family_groups`, `family_members`, `org_invitations`, plus various secondary tables.

## Verification

- `mcp__supabase__get_advisors --type performance` returns no multi-permissive RLS lints
- Spot-check 2 consolidated tables: run an EXPLAIN ANALYZE on a typical SELECT, confirm policy filter list is shorter

## Publish

```bash
gh issue create \
  --repo matchmoments-admin/ask-arthur \
  --title "[P3] RLS rewrite debt audit on ~10 remaining tables (multi-permissive consolidation)" \
  --label "severity:p3,ready-for-agent,domain:db,security" \
  --body-file 07-p3-rls-rewrite-debt.md
```
