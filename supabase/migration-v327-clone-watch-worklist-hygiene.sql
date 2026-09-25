-- v327 — Clone Watch worklist hygiene (#1235, map #1224)
--
-- Two cheap fixes found by EXPLAIN (ANALYZE, BUFFERS) against prod on
-- 2026-09-26 (3,630 alerts / 3,630 classifications). No worklist predicate or
-- signature changes — callers are untouched.
--
-- 1. clone_watch_classifications autovacuum tuning.
--    The preclassify worklist (list_clone_alerts_pending_preclassify) anti-joins
--    this table through its pkey. The table is insert-only (one row per alert,
--    UPSERT on re-classify), so autovacuum's insert trigger — default
--    autovacuum_vacuum_insert_scale_factor 0.2 — had not fired since
--    2026-08-21 (1,052 inserts since). With a stale visibility map the
--    "Index Only Scan" still visits the heap: 2,404 heap fetches, 85 of the
--    query's 89 ms. Lowering the insert scale factor to 0.05 keeps the
--    visibility map current as the table grows (~1k rows/month today → a
--    vacuum every ~180 inserts at this size). Pair with a one-off
--    VACUUM (ANALYZE) run by an operator AFTER this migration — VACUUM cannot
--    run inside the migration's transaction.
--
-- 2. Drop idx_clone_alerts_shop_open (0 scans since stats were last reset;
--    8 kB). Partial index on target_shop_id IS NOT NULL for the shop-owner
--    alert view — 0 of 3,630 rows have a target_shop_id, and every reader in
--    the app filters target_shop_id IS NULL (clone-watch page, newsletter
--    prepare/evidence, weekly digest). An unused index still costs on every
--    INSERT and blocks HOT updates on the columns it covers.
--    Reverse (if the shop-owner view ships):
--      CREATE INDEX idx_clone_alerts_shop_open ON public.shopfront_clone_alerts
--        USING btree (target_shop_id, severity DESC, first_seen_at DESC)
--        WHERE ((alert_state = 'open'::text) AND (target_shop_id IS NOT NULL));
--    (definition from migration-v140-shopfront-init.sql:92, as read from
--    pg_get_indexdef in prod.)
--
-- Deliberately NOT done: a maintained `needs_retrieve` flag / partial index for
-- list_clone_alerts_pending_urlscan_retrieve. Its OR predicate (classification
-- NULL / resubmitted / legacy retrieve_pending) can't be served by one index,
-- so it seq-scans — 45 ms and 1,071 shared buffers at 3,630 rows, ~12.5 µs per
-- row. Linear growth reaches ~0.6 s at ~50k rows; revisit then (≈4 years at
-- ~1k alerts/month, ≈5 months at 10× ingest). Its RETURN columns stay as-is:
-- the retrieve lane reads urlscan_evidence (reputationFromEvidence), and the
-- LIMIT caps the payload at 100 rows.
--
-- Idempotent: re-running is a no-op.

ALTER TABLE public.clone_watch_classifications
  SET (autovacuum_vacuum_insert_scale_factor = 0.05);

DROP INDEX IF EXISTS public.idx_clone_alerts_shop_open;
