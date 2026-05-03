# pgvector index policy: HNSW vs IVFFlat

**Status:** accepted (2026-05-04)

When a new pgvector column is added to this codebase, default to **HNSW** (`USING hnsw (col vector_cosine_ops) WHERE col IS NOT NULL`) unless the table has all of the following:

1. > 100k rows AND a build-time-sensitive ingest pattern (e.g. nightly re-cluster that rewrites every embedding), AND
2. The query pattern is "give me roughly nearest 100, recall@100 fine to be 0.85" rather than "give me top-1, recall@1 must be near 1.0".

Tables today and the index choice they took:

| Table                           | Rows now | Index   | Why                                                                                |
| ------------------------------- | -------- | ------- | ---------------------------------------------------------------------------------- |
| reddit_post_intel.embedding     | ~1k      | IVFFlat | Cohort-based re-embeds nightly; build cost matters. Lists=100.                     |
| reddit*intel_themes.centroid*\* | ~50      | IVFFlat | Same backfill pattern as the post intel; small enough that either index is fine.   |
| acnc*charities.name_mission*\*  | ~64k     | HNSW    | Read-heavy, slow growth, top-1/top-5 recall matters for typosquat detection.       |
| scam_reports.embedding          | ~25      | HNSW    | Unbounded growth as adoption ramps; HNSW recall scales better than IVFFlat at 1M+. |
| verified_scams.embedding        | small    | HNSW    | Authoritative anchors — top-K accuracy critical even at small N.                   |

## Why HNSW is the default

HNSW (Hierarchical Navigable Small World) gives consistently better recall@k for small k (typically what consumer-facing similarity surfaces want) and degrades gracefully as the table grows. The build cost is real but amortises to nothing on read-heavy tables. The only environments where IVFFlat wins are: large pre-batched embedding workloads where the index is rebuilt rather than maintained, or recall@100+ queries where the partition-quality of `lists` doesn't matter much.

`m=16, ef_construction=64` (pgvector defaults) are appropriate for tables up to ~1M rows. For larger tables we should bump `m=24, ef_construction=128` — defer until row counts hit that range and add as a follow-up migration.

`ef_search` is set per-RPC via `set_config('hnsw.ef_search', '80', true)`. 80 (vs default 40) gives ~0.92 → ~0.98 recall@10 with sub-millisecond latency cost. Bump higher only if a specific RPC's eval set demands it.

## Partial indexes only

Every embedding-bearing index in this codebase is **partial** (`WHERE col IS NOT NULL`). Reasons:

1. The transition from "0 rows embedded" to "fully backfilled" happens row-by-row over many minutes. A non-partial index forces a rebuild halfway through; partial sidesteps it.
2. SAFE-verdict scam_reports (and rows where the embed pass intentionally skipped) keep `embedding IS NULL` permanently. Including them would bloat the index for no retrieval benefit — they're filtered out of every query path anyway.
3. Index size shrinks proportionally to `count(*) WHERE col IS NULL` ratio, which is meaningful at our scale.

## When to switch from IVFFlat to HNSW

If a table currently using IVFFlat starts hitting recall complaints (eval set Pass@k drops, or B2B clients report "I expect to find X but the API returns Y"), the migration is one new partial HNSW index next to the existing IVFFlat, an `ANALYZE`, and a one-PR cutover of the RPC's `set_config` line. The two indexes can coexist while we cut over — Postgres will pick one or the other per the query planner and the unused one can be dropped after a stable week.

## When NOT to add a vector index at all

If the table will hold <100 embeddings ever (e.g. a small enum-like reference set), skip the index entirely. Sequential scan on a 100-row table is faster than the index probe.
