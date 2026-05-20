# Ask Arthur — Database

Supabase Postgres (project `rquomhcgnodxzkhokwni`). 75+ tables across 12 domain areas, 121 migrations (v2 → v122), 71 RPCs (all `SECURITY DEFINER`), 9 triggers, 11 archive shadows, 3 partitioned shells.

**Hot-table notation:** `[hot ⚠]` = write-frequent. New large indexes (HNSW, large GIN, BRIN over wide ranges) **must** go on a 1:1 sibling table per [ADR-0005](../adr/0005-pgvector-index-policy.md). See `CLAUDE.md` Critical Rules for the chunking + index-on-sibling rationale (born from incident 2026-05-09).

---

## Tables by domain

### Identity / Billing

- `user_profiles` — Soft PII cache of `auth.users`, org affiliation
- `api_keys` — B2B API key hashes, tier, daily limits
- `subscriptions` — Stripe billing + plan sync (linked to `api_keys`)
- `organizations` — Multi-tenant orgs
- `org_members` — Org membership + role (owner / admin / member)
- `org_invitations` — Pending invites with hashed tokens
- `family_groups`, `family_members`, `family_activity_log` — Consumer family-protection feature
- `phone_footprint_entitlements` — Stripe-synced tier + quota (independent of `api_keys.tier`)

### Analysis pipeline (write-hot)

- `scam_reports` `[hot ⚠]` — Central node: every user analysis. **Embedding HNSW** (partial, `WHERE embedding IS NOT NULL`). v21 (intelligence core), v71 (partitioned shell), v89 (embedding). **`analysis_result` JSONB** also carries `shopSignal` (Stage 0.5, no migration — uses existing v21 GIN `jsonb_path_ops` index for `?` operator lookups; see `docs/ops/shop-signal-measurement.md`). Stage 1 #320 adds a typed `shop_checks` sibling table; the JSONB shim stays through the 30-day measurement window (shim removal deferred to post-day-31).
- `verified_scams` — High-confidence authoritative scams. **Embedding HNSW** (read-only anchor corpus). v89.
- `scam_entities` `[hot ⚠]` — Unified entity index (phone / email / url / domain / ip / crypto_wallet / bank_account). `UNIQUE (entity_type, normalized_value)`. v21.
- `report_entity_links` — M-to-many: reports ↔ entities (extraction method, role). v21.
- `scam_clusters` — Entity co-occurrence clusters. v22.
- `cluster_members` — Cluster membership.
- `scam_contacts`, `scam_ips`, `scam_crypto_wallets`, `scam_urls` — Entity feeds (via `bulk_upsert_*` RPCs).

### Feeds / Intel

- `feed_items` `[hot ⚠]` — Unified feed: reddit narratives + news alerts (`source IN ('scamwatch_alert','acsc','asic_investor','user_report','verified_scam')`). **Partial IVFFlat** for narrative rows only (v97). Retention: >365d → archive (v98).
- `feed_ingestion_log` — Scraper run metadata + error telemetry (v11). Pruned 90d.
- `feed_http_cache` — ETag / Last-Modified cache for RSS scrapers, service-role only (v97). Pruned 30d.
- `feed_summaries` — Aggregated digest per feed per day (v48).
- `reddit_post_intel` — Sonnet-classified Reddit narratives (intent_label, modus_operandi, brands_impersonated[], novelty_signals[], tactic_tags[]). `UNIQUE(feed_item_id)`. Embedding IVFFlat. v82.
- `reddit_intel_themes` — Cluster heads (`slug UNIQUE`, `member_count`, `signal_strength`, `wow_delta_pct`). Centroid embedding IVFFlat. v82.
- `reddit_post_intel_themes` — M-to-many: posts ↔ themes. v82.
- `reddit_intel_quotes` — PII-scrubbed quotes (≤140 char). DELETE after 365d. v82.
- `reddit_intel_daily_summary` — Daily lead narrative + `emerging_threats` / `brand_watchlist` JSONB. v82.
- `reddit_processed_posts` — Dedup registry (`feed_item_id`, `external_post_id UNIQUE`).

### Feedback & Triage (write-hot)

- `verdict_feedback` — User thumbs-up / thumbs-down + reason codes. v47, v66, v67.
- `feedback_triage_queue` `[hot ⚠]` (MV) — Active-learning queue: `triage_score = uncertainty × impact_weight`. Refreshed 5-min cron. v94.

### Phone Footprint

- `phone_footprints` — Snapshot per lookup (`msisdn_e164`, `composite_score`, `pillar_scores`, `coverage`). BRIN on `expires_at`. v75.
- `phone_footprint_monitors` — Saved numbers under refresh (self / family / fleet scope). Partial uniques on (owner, msisdn_hash, scope) while active. v75.
- `phone_footprint_alerts` — Delta events (band_change, score_delta, new_breach, sim_swap). v75.
- `phone_footprint_refresh_queue` — Claim queue for Inngest refresh. `UNIQUE (monitor_id)`. v75.
- `phone_footprint_otp_attempts` — Twilio Verify anti-abuse forensics. v75.
- `sim_swap_monitors`, `sim_swap_events`, `device_swap_events` — SIM / device fraud monitoring (B2B).
- `phone_lookups` — Cached phone reputation lookups. v35, v19.
- `telco_api_usage` — Vonage API usage per org / user. v76.
- `telco_webhook_subscriptions` — Vonage webhook config. v76.

### Breach Defence

- `breaches` — Canonical AU breach records (`slug UNIQUE`, entity_name, abn, threat_actor, victim_count, data_classes[], ndb_status). v80.
- `breach_victims_index` — SHA-256(email/phone/DL/medicare/passport). Service-role only; `check_breach_exposure(...)` RPC is the public query gate. v80.
- `breach_sources_raw` — Raw scraper captures (OAIC NDB, ransomware DLS, news). Created_by / last_edited_by audit. v80.

### Charity Check

- `acnc_charities` `[hot ⚠]` — ABN-keyed charity register mirror (63,637 rows, weekly source / daily scraper). Trigram GIN on `charity_legal_name`, `other_names`. v83. **v121 moved embedding → sibling.**
- `acnc_charity_embeddings` — 1024d Voyage embedding for name+mission. HNSW. Sibling to `acnc_charities`. v121 (added), v122 (dropped parent embedding cols).
- `pfra_members` — PFRA donor registry (B2B). Indexed on `abn`, `acnc_charity_abn`. v85.

### Telemetry / Safety

- `cost_telemetry` — Per-call AI / paid-API spend log (`feature`, `provider`, `operation`, `units`, `unit_cost_usd`, `estimated_cost_usd`, `user_id`, `request_id`). v62. BRIN on `created_at`.
- `cost_telemetry_daily_rollup` (MV) — Aggregated daily sums by feature / provider. v112.
- `cost_telemetry_partitioned` — RANGE(created_at) monthly shell, awaiting operator cutover. v71.
- `feature_brakes` — Cost caps per feature (e.g., `reddit_intel`: A$10/day). v65.

### Deepfake / Media

- `deepfake_detections` — Media analysis results (file, hash, deepfake_confidence, predicted_labels). v54.
- `media_analyses` — Image / video forensics (media_type, format, dimensions, exif_data, phash_vector). JSONB versioning v117.

### Brand & Ads

- `brand_impersonation_alerts` — Detected brand abuse. Auto-escalate trigger v49.
- `flagged_ads` — Suspicious ads (platform, url, copy, media_urls, review_status). Auto-escalate trigger v53.
- `known_brands` — Canonical brand registry. v119.

### Fraud Manager & Investigation

- `fraud_manager_records` — Fraud case tracking. v58.
- `investigation_records` — Investigation metadata. v28.

### Onward Reporting

- `onward_report_log` — Report dispatch to regulators (ACNC, ASIC, etc). v119.
- `provider_reports`, `provider_actions` — External provider escalations (v39).
- `regulator_alert_pushes` — Onward report delivery tracking.

### Bot queue & Bot subscriptions

- `bot_message_queue` — Async bot-message processing (pg_net webhook trigger; see [background-workers.md](./background-workers.md)).
- `bot_subscriptions` — Bot platform subscription state.

### Scans / Sites

- `scan_results` — Every `/api/scan` submission (target, scan_type, visibility, share_token). v11. Archive >180d (v118).
- `sites` — Site registry. domain, badge_token. v20.
- `site_audits` — Website security-audit results. `test_results JSONB` (GIN). v20.

### Commerce & Content

- `leads` — Customer lead intake. v56.
- `shop_checks` `[hot ⚠]` — Shop Signal Stage 1 persistence: one row per commerce-flagged analyze. `signal` JSONB carries the ShopSignal payload + APIVoid `paidProviderVerdict`. 90-day TTL (BRIN on `ttl_expires_at`), swept by `cleanup_expired_shop_checks` via `/api/cron/shop-checks-retention` (`45 3 * * *`). Service-role RLS. RPCs: `upsert_shop_check`, `update_shop_check_signal` (both `SECURITY INVOKER`, service-role grant). v135 (#320).
- `stripe_event_log` — Webhook events. Idempotent on `event_id`. v57.
- `extension_subscriptions`, `extension_installs` — Extension license + per-install identity (ECDSA public key). v34–v61.
- `blog_posts` — CMS posts. `search_vector` TSVECTOR GIN. v2.
- `blog_categories` — Category taxonomy. v18.
- `email_subscribers` — Newsletter signup. DENY_ALL RLS (v109).

### Misc / Internal

- `device_push_tokens` — Push token registration per user / org. v32.
- `subscriber_match_checks` — Matched subscription grants (internal).

---

## Archive shadows (×11)

All have `BRIN(created_at)` for cheap range queries.

| Archive                              | Parent                       | Threshold                      | Trigger                               |
| ------------------------------------ | ---------------------------- | ------------------------------ | ------------------------------------- |
| `flagged_ads_archive`                | `flagged_ads`                | >180d                          | v118 `archive_secondary_tables_batch` |
| `deepfake_detections_archive`        | `deepfake_detections`        | >180d                          | v118                                  |
| `media_analyses_archive`             | `media_analyses`             | >180d                          | v118                                  |
| `scan_results_archive`               | `scan_results`               | >180d                          | v118                                  |
| `verdict_feedback_archive`           | `verdict_feedback`           | >180d                          | v118                                  |
| `brand_impersonation_alerts_archive` | `brand_impersonation_alerts` | >180d                          | v118                                  |
| `report_entity_links_archive`        | `report_entity_links`        | >180d                          | v118                                  |
| `feed_items_archive`                 | `feed_items`                 | >365d                          | v98 `archive_feed_items_batch`        |
| `scam_reports_archive`               | `scam_reports`               | >180d (planned partition move) | `archive_scam_reports_batch`          |
| `cluster_reports_archive`            | `cluster_members`            | Dedup cleanup                  | `cleanup_old_reddit_posts`            |

---

## Partitioning

| Parent                       | Scheme                      | Status                           | Notes                                                                                              |
| ---------------------------- | --------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `cost_telemetry_partitioned` | RANGE(`created_at`) monthly | Shell created (v71), seeded 6 mo | Awaiting operator cutover. `ensure_next_month_partitions()` cron keeps 2-mo forward window seeded. |
| `scam_reports_partitioned`   | RANGE(`created_at`) monthly | Shell created (v71), seeded 6 mo | Operator cutover per `docs/partitioning-runbook.md`. Exclusive lock; maintenance window required.  |
| `feed_items_partitioned`     | RANGE(`created_at`) monthly | Shell created (v71), seeded 6 mo | Same cutover pattern as scam_reports.                                                              |

---

## RPCs (71 total — all `SECURITY DEFINER`)

### Analysis pipeline

- `create_scam_report(...)` — Insert report row, return PK. Source of truth for v21 intelligence core. ON CONFLICT idempotent via v73 `idempotency_key`.
- `upsert_scam_entity(...)` — Insert / bump entity, return `{entity_id, is_new}`. Idempotent.
- `link_report_entity(...)` — M-to-many junction. Idempotent `ON CONFLICT (report_id, entity_id, role)`.
- `upsert_scam_url(...)`, `upsert_scam_contact(...)` — Feed-specific entity upserts.
- `trigger_entity_enrichment_pending(...)` — Flag entity for async enrichment.
- `bulk_upsert_feed_url(...)`, `bulk_upsert_feed_ip(...)`, `bulk_upsert_feed_crypto_wallet(...)`, `bulk_upsert_feed_entity(...)` — Batch feed ingestion.
- `upsert_feed_item(...)` — Feed item insert / update.
- `get_unembedded_narrative_feed_items(p_limit)` — Cron poller for `feed-items-embed`. Service-role only.

### Search & retrieval

- `match_scam_reports(embedding, match_count, min_similarity, since_days)` — HNSW cosine NN over `scam_reports.embedding`. Excludes SAFE verdicts, time-windowed (default 30d). `ef_search=80` for 0.98 recall@10.
- `match_verified_scams(embedding, match_count, min_similarity)` — HNSW over `verified_scams.embedding`. No recency filter (authoritative anchors).
- `match_reddit_intel(embedding, limit)` — IVFFlat over `reddit_post_intel.embedding`.
- `match_reddit_intel_themes(centroid_embedding, limit)` — Centroid-based theme matching.
- `match_themes_by_centroid(...)` — Greedy centroid assignment (cosine ≥ 0.78).
- `match_charities_by_embedding(embedding, limit)` — Sibling HNSW on `acnc_charity_embeddings`. v121 JOIN pattern.
- `match_feed_items_narrative(embedding, limit)` — Narrative feed retrieval.
- `search_charities(query, limit)` — Trigram + ILIKE prefix ranking for autocomplete. `SQL STABLE`. REVOKE PUBLIC, GRANT anon / authenticated / service_role.
- `fraud_manager_search(...)` — B2B fraud-case full-text.
- `match_scam_reports_hybrid(...)` — Hybrid BM25 + vector reranking.

### Phone footprint & Breach Defence

- `report_phone_number(msisdn, tier)` — Lookup + analysis. Returns footprint.
- `phone_footprint_internal(msisdn, ...)` — Core lookup engine. Multi-provider orchestration.
- `check_breach_exposure(identifier_type, identifier_hash)` — Safe query gate for `breach_victims_index`.
- `assert_fleet_capacity(org_id)` — Check fleet quota before monitor creation.
- `sync_phone_footprint_entitlements(...)` — Stripe sync → quotas.
- `anonymise_expired_footprints(...)` — Replace `msisdn_e164` with 'REDACTED' after snapshot expires.
- `sweep_inactive_monitors(...)` — Soft-delete consent-lapsed monitors. Cron-called.

### Feedback & Triage

- `refresh_feedback_triage_queue()` — `REFRESH MATERIALIZED VIEW CONCURRENTLY feedback_triage_queue`. Service-role only. Called by `feedback-triage-refresh` cron (5 min).

### Cost & Telemetry

- `refresh_cost_telemetry_daily_rollup()` — Aggregate daily sums. Service-role only.
- `prune_cost_telemetry(days)`, `prune_feed_http_cache(days)`, `prune_feed_ingestion_log(days)`, `prune_telco_events(...)` — Retention pruning.

### Archive & housekeeping

- `archive_feed_items_batch(batch_size, days)` — Bulk move >N days to `feed_items_archive`. Chunked `INSERT...SELECT`.
- `archive_scam_reports_batch(batch_size, days)` — Bulk move >N days. Chunked.
- `archive_secondary_tables_batch(batch_size, days)` — Bulk move across 6 tables. v118.
- `archive_old_urls(archive_days)`, `mark_stale_urls(stale_days)`, `mark_stale_ips(stale_days)`, `mark_stale_crypto_wallets(stale_days)` — URL / IP / wallet staleness.
- `cleanup_old_reddit_posts(days)` — Delete `reddit_processed_posts` >N days.
- `cleanup_expired_shop_checks(batch_size)` — Delete one batch of TTL-expired `shop_checks` rows (`ttl_expires_at < now()`). Looped by the retention cron. v135.

### Partitioning

- `ensure_monthly_partition(parent, month)` — Idempotent monthly partition creation. Service-role only.
- `ensure_next_month_partitions()` — Called by daily cron; keeps forward window seeded.

### Cluster & entity

- `compute_entity_risk_score(entity_id)` — Aggregate report counts + context.
- `get_threat_intel_export(verdict, scam_type, ...)` — B2B export of threat intel.
- `get_unreported_entities(...)` — Find entities with no outbound reports.

### User & org

- `create_organization(name, user_id)` — New org + auto-add creator as owner.
- `get_user_org(user_id)` — Lookup user's org.
- `set_user_admin(user_id, is_admin)` — Admin toggle.
- `generate_api_key_record(...)`, `generate_org_api_key(org_id, tier, ...)` — Mint API key + hash.
- `user_owns_key_hash(key_hash)` — `SQL STABLE` BOOLEAN helper for API auth.
- `get_extension_tier(user_id)` — Resolve tier from subscription / api_keys.
- `get_jurisdiction_summary(country_code, ...)`, `get_world_scam_stats(...)` — World-stats dashboard sources. v60.

### Triggers & callbacks

- `handle_new_user(...)` — Auth trigger (v31): create `user_profiles` row on `auth.users` INSERT.
- `sync_subscription_tier(api_key_id, plan, status)` — Sync Stripe subscription → `api_keys.tier` + limits.
- `record_financial_impact(report_id, ...)` — Log estimated user harm per report. v40.
- `get_onward_destinations(verdict, scam_type, ...)` — Routing table for onward reporting. v119.
- `increment_check_stats(scam_type, verdict, ...)` — Tally check submissions per type / verdict.
- `increment_celebrity_detection_count(...)` — Deepfake-model telemetry.
- `submit_provider_report(report_id, provider, ...)` — Provider escalation bridge. v39.
- `log_api_usage(api_key_id, endpoint, ...)` — B2B API audit log. v25.
- `lookup_pfra_member(abn)` — PFRA donor registration lookup.

---

## Triggers (9)

| Trigger                              | Table                 | Function                                | Purpose                                          |
| ------------------------------------ | --------------------- | --------------------------------------- | ------------------------------------------------ |
| `on_auth_user_created`               | `auth.users`          | `handle_new_user()`                     | Create `user_profiles` row on signup (v31)       |
| `trg_breaches_updated_at`            | `breaches`            | `update_breaches_updated_at()`          | Auto-bump `updated_at` (v80)                     |
| `trg_leads_updated_at`               | `leads`               | `update_leads_updated_at()`             | Auto-bump `updated_at` (v24–v60)                 |
| `trg_media_analyses_updated_at`      | `media_analyses`      | `update_media_analyses_updated_at()`    | Auto-bump `updated_at` (v28)                     |
| `trg_organizations_updated_at`       | `organizations`       | `update_organizations_updated_at()`     | Auto-bump `updated_at` (v55)                     |
| `trg_entity_enrichment_pending`      | `scam_entities`       | `trigger_entity_enrichment_pending()`   | Mark entity for async enrichment on INSERT (v23) |
| `trg_family_group_add_owner`         | `family_groups`       | `auto_add_owner_to_family()`            | Auto-add creator as owner on INSERT (v33)        |
| `deepfake_detection_increment_count` | `deepfake_detections` | `increment_celebrity_detection_count()` | Tally deepfake-model runs per celebrity (v54)    |
| `flagged_ads_auto_escalate`          | `flagged_ads`         | `auto_escalate_flagged_ad()`            | Auto-escalate high-risk ads to provider (v53)    |

### Database webhook (pg_net, not a `CREATE TRIGGER`)

`bot_message_queue` INSERT → Supabase Database Webhook → `pg_net.http_post` → `/api/bot-webhook`. Configured in Supabase dashboard, **not** in migration SQL. Backed by `/api/cron/bot-queue-sweep` (every 6h) as the safety net. See [background-workers.md](./background-workers.md) and [data-flows.md](./data-flows.md) for the full bot dispatch flow.

---

## RLS posture

Standard policy patterns across the schema (audited v104 + v107 + v109):

| Pattern                        | Example tables                                                   | Shape                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Service-role only**          | `breach_victims_index`, `feed_http_cache`, archive shadows       | `USING(auth.role() = 'service_role')`. Public access goes through a SECURITY DEFINER RPC.                        |
| **Public read, service write** | `scam_reports`, `verified_scams`, `feed_items`, `acnc_charities` | `USING(true)` for SELECT. INSERT/UPDATE/DELETE restricted to service role. Write-once data.                      |
| **Org-scoped multi-policy**    | `api_keys`, `phone_footprint_monitors`                           | 4 policies (select/insert/update/delete) joining `org_members`. User can see own + org members'; staff+ for CUD. |
| **Explicit DENY** (v109)       | `email_subscribers`, `verdict_feedback`, `feed_ingestion_log`    | Deny anon + authenticated. Service-role-only via trigger from frontend RPC.                                      |

Audit waves:

- **v104** — security-definer lockdown across all RPCs (prevents unprivileged callers from escalating privilege).
- **v106** — `USING(true)` rewrite (explicit, not implicit).
- **v107** — multi-permissive policy consolidation (merge redundant PERMISSIVE policies into one with explicit `TO` clause).
- **v109** — explicit DENY policies on sensitive tables.

---

## Migration timeline (v2 → v122)

Approximate domain bundling:

| Range     | Theme                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| v2–v9     | Core bootstrap (users, verified_scams, blog_posts, api_keys, scan_results)                        |
| v10–v13   | Pipeline core (bot_message_queue, feed_items, feed_ingestion_log, scam_urls)                      |
| v14–v20   | Entity + audit (scam_ips, scam_crypto_wallets, sites, site_audits)                                |
| v21–v23   | Intelligence core (scam_reports, scam_entities, report_entity_links, clusters)                    |
| v24–v30   | Scoring + billing (api_tiers, subscriptions, api_keys evolution)                                  |
| v31–v35   | Auth + reputation (auth.users trigger, push_tokens, phone_reputation)                             |
| v36–v48   | Feed expansion (reddit_feed, threat_intel_exports, feed_summaries, brand_alerts)                  |
| v49–v60   | Deepfake + org (flagged_ads, deepfake_detections, organizations, leads, fraud_manager)            |
| v61–v68   | Telemetry + archive (cost_telemetry, feature_brakes, verdict_feedback, archival shadows)          |
| v69–v77   | Phone Footprint ships + RLS tightening                                                            |
| v78–v90   | Breach Defence + Embeddings (breaches, breach_victims_index, HNSW on scam_reports/verified_scams) |
| v91–v99   | Reddit Intel + News Intel narratives + retention                                                  |
| v100–v107 | DB hygiene + RLS standardisation (FK indexes, DENY_ALL, multi-permissive consolidation)           |
| v108–v122 | Refinement + sibling tables (cost_telemetry_daily_rollup, acnc_charity_embeddings)                |

---

## Hygiene backlog

Deferred items from the 2026-04-23 advisor audit (sourced from CLAUDE.md → moved here):

- 177 unused indexes
- 21 empty partitioned shadows
- 16 `USING (true)` RLS rewrites (most cleared in v106; remainder tracked here)
- Multiple-permissive-policy consolidation (most cleared in v107)
- `pg_trgm` extension relocation
- Phase 1 commercial tables to ship: `cases`, `audit_log`, `evidence`, `spf_principle_events`, `api_usage_log` partitioning, webhook ledger, tenant residency

**v78 cleared the P0 advisor ERRORs only** — everything else lives in `BACKLOG.md` → `Database Hygiene & SPF Readiness`.

---

## Hot tables — index strategy verified

Per [ADR-0005](../adr/0005-pgvector-index-policy.md) and CLAUDE.md Critical Rules:

| Table                   | Write-frequent?                    | Index strategy                                                                                                                                     |
| ----------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acnc_charities`        | Yes (daily scraper updates weekly) | Embedding moved to **sibling** `acnc_charity_embeddings` (v121). Parent: trigram GIN + BTree only. v122 dropped parent embedding cols.             |
| `scam_reports`          | Yes (unbounded user submissions)   | **Direct HNSW partial index** `WHERE embedding IS NOT NULL` (v89). Avoids reindexing during NULL→populated transition.                             |
| `verified_scams`        | No (editor-curated, <100 rows)     | **Direct HNSW** (v89). Read-only anchor corpus — cost amortised.                                                                                   |
| `feedback_triage_queue` | No (MV refreshed 5-min)            | No embedding; `triage_score` REAL only. Indexes: `feedback_id UNIQUE`, `triage_score`.                                                             |
| `feed_items`            | Yes (daily scraper ingest)         | **Partial IVFFlat** for narrative rows only (v97, `lists=50`). No sibling — partial index keeps cost bounded.                                      |
| `scam_entities`         | Yes (upserted per report link)     | No embedding; `report_count` aggregate. Indexes: `(entity_type, normalized_value) UNIQUE`, `normalized_value`, `entity_type`, `report_count DESC`. |

---

## PL/pgSQL gotchas (verified in prod)

Two recurring failure modes — both caught in `packages/scam-engine/src/__tests__/rpcs.smoke.test.ts`:

1. **`RETURNS TABLE (col_name …)`** — unqualified `col_name` in the body resolves to the OUT-parameter variable, not a table or CTE column. Add `#variable_conflict use_column` immediately after `AS $$`. Without it, `select id from cte` raises `ERROR 42702: column reference "id" is ambiguous` at function-call time, never at `CREATE FUNCTION` time.
2. **`SET search_path = ''`** — hides extension operators like pgvector's `<=>`. Use `SET search_path = public, pg_catalog` for `SECURITY INVOKER` functions that depend on extension-provided operators. Reserve the empty form for `SECURITY DEFINER` functions where unqualified-name exploitation is the real threat.

Both bites surface as immediate exceptions on the first call. Smoke test against a preview branch after applying any migration that touches function bodies:

```bash
SUPABASE_INTEGRATION_TEST_URL=… SUPABASE_INTEGRATION_TEST_SERVICE_KEY=… \
  pnpm --filter @askarthur/scam-engine test rpcs.smoke
```
