---
severity: P3
title: "[P3] 177 unused indexes — schedule drop sweep (advisor backlog from 2026-04-23)"
labels: severity:p3, ready-for-human, domain:db, ops
action_type: DB · maintenance window
estimated_time: ~half day (analysis) + maintenance window
---

## Summary

The 2026-04-23 db-hygiene advisor audit flagged **177 unused indexes** (zero `pg_stat_user_indexes.idx_scan` over the observation window). Migration v78 cleared the P0 ERRORs; this is the deferred performance backlog. Per `docs/system-map/database.md#hygiene-backlog`.

## Impact

- **Disk:** indexes consume storage proportional to the indexed columns (often non-trivial — trigram GIN can be ~30 % of table size)
- **Write amplification:** every INSERT / UPDATE on the parent table updates these indexes too, dirtying pages and burning Disk IO budget on Supabase compute
- **No correctness bug** — pure hygiene. Some "unused" indexes are intentionally there for failover paths or quarterly reports; need human judgement before dropping

## Fix

1. **Pull current list** (NOT a one-time snapshot — re-run, things change):

   ```sql
   SELECT schemaname, tablename, indexname, indexdef,
          pg_size_pretty(pg_relation_size(indexrelid)) as size
   FROM pg_stat_user_indexes
   WHERE idx_scan = 0
     AND schemaname = 'public'
   ORDER BY pg_relation_size(indexrelid) DESC;
   ```

2. **Categorise** each entry into:
   - **Safe to drop** — clearly redundant or replaced by a newer compound index
   - **Keep** — used by infrequent admin queries / quarterly reports / failover RPCs
   - **Defer** — recently added (< 30 days), no traffic yet; re-evaluate next quarter

3. **Author migration** `v123_drop_unused_indexes.sql` with `DROP INDEX IF EXISTS` per entry, **excluding** any index used by a foreign key or unique constraint

4. **Schedule maintenance window** — `DROP INDEX` is fast on hot tables but takes a brief ACCESS EXCLUSIVE lock. Co-ordinate via the partitioning runbook template

5. **Track results** — what was dropped, the disk reclaimed, any post-drop query-plan regressions

## Verification

- Re-run the query above after the migration — count should drop by N (where N is the number dropped)
- No new advisor WARN/ERROR
- `pg_relation_size` of key tables reduced by ≥ X MB (record actual)
- Spot-check 5 critical queries via `EXPLAIN (ANALYZE)` to confirm no plan regressions

## Publish

```bash
gh issue create \
  --repo matchmoments-admin/ask-arthur \
  --title "[P3] 177 unused indexes — schedule drop sweep (advisor backlog from 2026-04-23)" \
  --label "severity:p3,ready-for-human,domain:db,ops" \
  --body-file 08-p3-unused-indexes-sweep.md
```
