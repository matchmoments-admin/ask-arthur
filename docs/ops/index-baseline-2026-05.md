# Unused index baseline — 2026-05-08

Snapshot of `pg_stat_user_indexes` ahead of the Phase 1.1 Stage C unused-index drop sweep.

**This is the "30-day clock" baseline.** Drop decisions land **after 2026-06-08** so the counters reflect at least a month of representative production traffic (including any month-end / billing-cycle peaks).

## Headline numbers

- **241 unused indexes** on hot tables (excluding pkeys + empty `*_partitioned_y%` shells).
- **~507 MB** combined size.
- **481 MB** of that is a single index — `acnc_charities.idx_acnc_name_mission_embedding_hnsw` — which is **NOT actually unused**; see "Do NOT drop" below.
- **~26 MB** is the realistic prize across the other 240 indexes.

## Re-running this snapshot

Re-run the same query before any drop PR so the comparison is apples-to-apples:

```sql
SELECT s.relname AS table_name,
       s.indexrelname AS index_name,
       s.idx_scan,
       s.idx_tup_read,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS size,
       i.indexdef
FROM pg_stat_user_indexes s
JOIN pg_indexes i ON i.indexname = s.indexrelname AND i.schemaname = s.schemaname
WHERE s.schemaname='public'
  AND s.idx_scan = 0
  AND s.indexrelname NOT LIKE '%_pkey'
  AND s.relname NOT LIKE '%_partitioned_y%'
  AND s.relname NOT LIKE '%_partitioned'
ORDER BY pg_relation_size(s.indexrelid) DESC;
```

Run via `mcp__supabase__execute_sql` against project `rquomhcgnodxzkhokwni`.

## Do NOT drop these (false negatives — feature-flag pre-staged)

These indexes show `idx_scan = 0` because the feature that consumes them is gated behind a flag that's currently OFF in prod. Dropping them would degrade the consumer the moment the flag flips.

| Index | Size | Consumer | Flag | Notes |
|---|---|---|---|---|
| `acnc_charities.idx_acnc_name_mission_embedding_hnsw` | **481 MB** | `match_charities_by_embedding` RPC at `packages/charity-check/src/providers/acnc.ts:376` | `NEXT_PUBLIC_FF_CHARITY_CHECK` | Verified 2026-05-08; would-be PR v101 aborted. Reconsider after flag is ON for 30 d, or migrate to `halfvec` (~240 MB, ~1% recall loss). |
| `verified_scams.idx_verified_scams_embedding_hnsw` | 208 kB | Phase-2 hybrid scam-search (`/api/v1/scams/search`) | Search adoption-gated | Audit before dropping; called by B2B search if exposed. |
| `scam_reports.idx_scam_reports_embedding_hnsw` | 104 kB | Same — hybrid retrieval over scam reports | Adoption-gated | Same audit. |
| `feed_items.idx_feed_items_embedding` | 1872 kB | News-intel hybrid retrieval (`/api/v1/intel/search`) | Adoption-gated | Same audit. |
| `reddit_post_intel.idx_rpi_embedding_ivfflat` | 6944 kB | Reddit intel theme matching | Theme matching cron | Verify theme-clustering RPC isn't hitting it before drop. |
| `reddit_intel_themes.idx_rit_centroid_ivfflat` | 3920 kB | Theme similarity / public deep-link page | `NEXT_PUBLIC_FF_REDDIT_INTEL_PUBLIC_PAGES` (default OFF) | Same flag-gated story as acnc HNSW. |
| `idx_vuln_kev`, `idx_vuln_in_wild`, `idx_vuln_au`, `idx_vuln_severity`, `idx_vuln_epss`, `idx_vuln_published`, `idx_vuln_tags`, `idx_vuln_products`, `idx_vuln_ingested_brin` | 24 kB – 256 kB | `vulnerability_detections` + B2B exposure flow | `NEXT_PUBLIC_FF_VULN_AU` / B2B adoption | 10 indexes on `vulnerabilities` — most likely all flag-gated. Audit before dropping any. |

**Rule:** before dropping a vector / vulnerability / charity index, grep for the column name in `apps/`, `packages/`, and `supabase/` migrations. If a downstream RPC uses the column with `<=>` or `<->` or `@@` or `@>`, the index is staged not dormant.

## Top 50 candidates by size (after exclusions above)

| Table | Index | Size | Type |
|---|---|---|---|
| scam_urls | idx_scam_urls_feed_reported_at | 2936 kB | btree partial |
| scam_urls | idx_scam_urls_domain | 2792 kB | btree |
| acnc_charities | idx_acnc_charities_other_names_gin | 1144 kB | GIN |
| scam_urls | idx_scam_urls_feed_sources | 944 kB | GIN |
| blog_posts | idx_blog_posts_search | 864 kB | GIN |
| acnc_charities | idx_acnc_embedding_model_version | 608 kB | btree partial |
| feed_items | idx_feed_items_fts | 424 kB | GIN |
| scam_urls | idx_scam_urls_brand | 144 kB | btree partial |
| feed_items | idx_feed_items_published_sort | 96 kB | btree partial |
| site_audits | idx_site_audits_test_results | 88 kB | GIN |
| reddit_post_intel_themes | idx_rpit_theme_id | 40 kB | btree |
| scam_reports | idx_scam_reports_analysis | 40 kB | GIN |
| reddit_post_intel | idx_rpi_brands | 32 kB | GIN |
| feed_items | idx_feed_items_provenance_tier | 32 kB | btree partial |
| scam_crypto_wallets | idx_scam_wallets_feed_sources | 24 kB | GIN |
| scam_entities | idx_scam_entities_feed_sources | 24 kB | GIN |
| feed_items | idx_feed_items_tags | 24 kB | GIN |
| acnc_charities | idx_acnc_charities_last_seen_brin | 24 kB | BRIN |
| cost_telemetry | idx_cost_telemetry_created_at_brin | 24 kB | BRIN |
| device_swap_events | idx_dse_created_brin | 24 kB | BRIN |
| sim_swap_events | idx_sse_created_brin | 24 kB | BRIN |
| subscriber_match_checks | idx_smc_created_brin | 24 kB | BRIN |
| vulnerability_detections | idx_vdet_detected_brin | 24 kB | BRIN |
| telco_signal_history | idx_tsh_obs_brin | 24 kB | BRIN |
| scam_reports | idx_scam_reports_body_tsv | 24 kB | GIN |
| phone_footprints | idx_pf_expires_brin | 24 kB | BRIN |
| scam_reports | idx_scam_reports_created_brin | 24 kB | BRIN |
| telco_api_usage | idx_tau_created_brin | 24 kB | BRIN |

(Full 241-row list not committed to keep the doc readable. Re-run the query above to regenerate when needed.)

## Per-table count distribution (top 25)

| Table | Unused | Notes |
|---|---:|---|
| scam_reports | 12 | Highest count; some are vector / FTS pre-staged |
| breaches | 11 | `breaches` is 0 rows — every index is unused by definition until backfill decision |
| vulnerabilities | 10 | Mostly flag-gated (B2B exposure flow); see "Do NOT drop" |
| subscriptions | 8 | Stripe-era duplicates from v57 hybrid migration |
| feed_items | 6 | Includes embedding + FTS (flag-gated) |
| scam_entities | 6 |  |
| phone_footprints | 6 | Phone Footprint mock-mode — feature not driving traffic yet |
| flagged_ads | 6 |  |
| verified_scams | 5 |  |
| media_analyses | 5 |  |
| phone_footprint_monitors | 5 | See phone_footprints note |
| acnc_charities | 4 | 481 MB HNSW is the headline |
| scam_urls | 4 |  |
| sim_swap_events | 4 | Vonage-not-yet-live; mock-mode rows |
| telco_api_usage | 4 | Same |
| deepfake_detections | 4 | Hive integration mock-mode |
| scam_clusters | 4 |  |
| organizations | 4 | B2B not yet ramped |
| user_profiles | 4 |  |
| telco_webhook_subscriptions | 4 |  |

The pattern is visible: tables tied to **mock-mode features** (`phone_footprint_*`, `telco_*`, `deepfake_detections`) and **0-row tables** (`breaches`) dominate. Flagging an index as "unused" without distinguishing feature-state is the gap this baseline closes.

## Recommended drop order (after 2026-06-08 re-check)

If still unused after 30 days:

1. **`scam_urls.idx_scam_urls_*` (4 indexes, ~6.8 MB)** — IOC table is hot; if these are still unused after a month of scraper traffic, they're genuinely redundant with the `(value, source)` UNIQUE index.
2. **`acnc_charities.idx_acnc_charities_other_names_gin` (1144 kB)** — `other_names` GIN. Trigram on `charity_legal_name` is the actively-used search index; this one was pre-staged for an alternative query path that didn't ship.
3. **`blog_posts.idx_blog_posts_search` (864 kB)** — FTS GIN on `search_vector`. If `/blog` site search isn't using PostgREST FTS, drop. Used to be relevant pre-Algolia; verify Algolia is the actual search backend.
4. **`feed_items.idx_feed_items_fts` (424 kB)** — same as above; only useful if a query does `WHERE to_tsvector('english', title) @@ to_tsquery(...)`.
5. **BRIN indexes on append-only tables (~24 kB each, ~10 of them)** — these are *correct shape* for time-range queries; if `idx_scan=0` after 30 days, the queries that should be using them aren't being issued. **Don't drop without identifying the missing query path** — adding the index back later is fast, but losing the planner hint loses signal during incident response.
6. **0-row table indexes on `breaches`, `vulnerability_detections`, `flagged_ads`** — defer until the parent feature ships; dropping now is wasted churn.

## Notes on `idx_scan=0` semantics

`pg_stat_user_indexes.idx_scan` resets on:
- Server restart (Supabase managed → infrequent but non-zero)
- `pg_stat_reset()` call
- Failover / migration

The counter is therefore "zero scans **since the last reset**", not "zero scans ever". Supabase Pro hasn't announced any recent failover for this project; the counter is reliable for a 30+ day window absent operational events.

## Plan reference

- Phase 1.1 Stage B (this doc) → Stage C (drop sweep, post-2026-06-08).
- BACKLOG.md → Database Hygiene & SPF Readiness → "Drop ~230 hot-table unused indexes".
