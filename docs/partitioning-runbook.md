# Partitioning Cutover Runbook

`supabase/migration-v71-partitioning-scaffold.sql` only creates the empty partitioned shells. This runbook documents the operator steps to actually move live data onto them. Do each table separately — do **not** attempt all three in one window.

## Why it's not automatic

The cutover involves a table swap under an exclusive lock. On a multi-GB table the COPY phase can run for minutes. Running that inline in a migration would block writes for the entire duration and is not safe for a live system.

## Preconditions

- `migration-v71-partitioning-scaffold.sql` has been applied. The `_partitioned` tables exist and have partitions covering the full date range of the source table (check with `\d+ cost_telemetry_partitioned`).
- You have a maintenance window. Budget 15 minutes for `cost_telemetry`, 30+ for `scam_reports`, 10 for `feed_items`.
- Retention cron (`scam-reports-retention`) has been running for at least one day and the hot table is trimmed to ≤90 days.

## Cutover pattern (repeat per table)

Worked example for `cost_telemetry`. Substitute table names for the other two.

### 1. Freeze writes briefly (optional but cleaner)

If your traffic tolerates it, pause the cron routes that write heavily to the table. For `cost_telemetry` that's most API routes — acceptable during off-peak if the window is short.

### 2. Copy data

```sql
BEGIN;
INSERT INTO cost_telemetry_partitioned
  (id, feature, provider, operation, units, unit_cost_usd,
   estimated_cost_usd, metadata, user_id, request_id, created_at)
SELECT
   id, feature, provider, operation, units, unit_cost_usd,
   estimated_cost_usd, metadata, user_id, request_id, created_at
  FROM cost_telemetry;
COMMIT;
```

For larger tables (`scam_reports`), batch by month to avoid one giant transaction:

```sql
-- Run once per month partition, oldest to newest.
INSERT INTO scam_reports_partitioned (...columns...)
SELECT ...columns... FROM scam_reports
 WHERE created_at >= '2025-01-01' AND created_at < '2025-02-01';
```

### 3. Swap the tables atomically

```sql
BEGIN;
ALTER TABLE cost_telemetry RENAME TO cost_telemetry_old;
ALTER TABLE cost_telemetry_partitioned RENAME TO cost_telemetry;

-- Reset sequences so new inserts don't collide with copied ids.
SELECT setval(
  pg_get_serial_sequence('cost_telemetry', 'id'),
  (SELECT MAX(id) FROM cost_telemetry)
);

-- Re-create any views / RLS policies that referenced the old name by OID.
-- The PARTITION BY (id, created_at) primary key means views that SELECT id
-- still work, but CREATE OR REPLACE any views that depended on the old
-- table structure now.

COMMIT;
```

### 4. Verify

```sql
-- Row counts should match within the write-freeze window.
SELECT
  (SELECT COUNT(*) FROM cost_telemetry)     AS new_count,
  (SELECT COUNT(*) FROM cost_telemetry_old) AS old_count;

-- Spot-check partitions.
SELECT tableoid::regclass, COUNT(*)
  FROM cost_telemetry
 GROUP BY 1
 ORDER BY 1;
```

### 5. Retire the old table

Keep `cost_telemetry_old` for 7 days as a rollback safety net. Then:

```sql
DROP TABLE cost_telemetry_old;
```

## Rollback

Before step 5, rollback is a simple rename-back:

```sql
BEGIN;
ALTER TABLE cost_telemetry RENAME TO cost_telemetry_partitioned;
ALTER TABLE cost_telemetry_old RENAME TO cost_telemetry;
COMMIT;
```

## Post-cutover

- `/api/cron/ensure-partitions` runs daily at 02:00 UTC and creates next-month partitions automatically. Verify it ran once before the first UTC month rollover after cutover.
- `/admin/health` shows `scam_reports (hot)` row count — after the retention cron trims + cutover, this number should stabilize around ~90 days of traffic.

## Table-specific notes

**`scam_reports`**: has FKs to it from `report_entity_links` (CASCADE) and `cluster_reports` (CASCADE) and `verdict_feedback_extension` (SET NULL). After the swap, the FKs still reference the renamed-to `scam_reports` table, so no relink required — but confirm with `\d report_entity_links` that the FK target is correct before retiring `scam_reports_old`.

**`scam_reports` — idempotency_key carry-forward (v73).** The column plus a partial unique index on `WHERE idempotency_key IS NOT NULL` was added by `migration-v73-analyze-idempotency.sql` to make the analyze-pipeline fan-out safe on retry. Unique indexes on **partitioned** tables in Postgres must include every partition key column, so on `scam_reports_partitioned` the index takes a different form:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_scam_reports_idempotency_key
  ON scam_reports_partitioned (idempotency_key, created_at)
  WHERE idempotency_key IS NOT NULL;
```

Include this in the "copy data" and "swap tables" steps for `scam_reports` — the single-column heap-table index will NOT copy across automatically, and the `create_scam_report` RPC's `ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL` must continue to find a matching partial unique index after the swap, or every retry will return an error instead of dedup'ing.

**`feed_items`**: has no known FKs inbound; lowest-risk of the three.

**`cost_telemetry`**: referenced by views `daily_cost_summary` and `today_cost_total`. Re-run the view DDL (v62 migration) after the swap if the views disappear.
