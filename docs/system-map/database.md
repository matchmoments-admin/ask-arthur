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
- `scam_ips`, `scam_crypto_wallets`, `scam_urls` — Entity feeds (via `bulk_upsert_*` RPCs). (`scam_contacts` was dropped at v41; the phone/email subset is now served by `scam_entities` + the `report_scam_entity` RPC.)

### Feeds / Intel

- `feed_items` `[hot ⚠]` — Unified feed: reddit narratives + news alerts (`source IN ('scamwatch_alert','acsc','asic_investor','user_report','verified_scam')`, plus the `inbound_*` competitor + regulator newsletter sources). **Partial IVFFlat** for narrative rows only (v97). Retention: >365d → archive (v98). **v214** adds `competitor_extracted_at timestamptz` — an attempt marker set by the `competitor-intel-extract` cron so already-processed competitor rows aren't re-extracted.
- `feed_ingestion_log` — Scraper run metadata + error telemetry (v11). Pruned 90d.
- `feed_http_cache` — ETag / Last-Modified cache for RSS scrapers, service-role only (v97). Pruned 30d.
- `feed_summaries` — Aggregated digest per feed per day (v48).
- `reddit_post_intel` — Sonnet-classified Reddit narratives (intent_label, modus_operandi, brands_impersonated[], novelty_signals[], tactic_tags[]). `UNIQUE(feed_item_id)`. Embedding IVFFlat. v82.
- `reddit_intel_themes` — Cluster heads (`slug UNIQUE`, `member_count`, `signal_strength`, `wow_delta_pct`). Centroid embedding IVFFlat. v82.
- `reddit_post_intel_themes` — M-to-many: posts ↔ themes. v82.
- `reddit_intel_quotes` — PII-scrubbed quotes (≤140 char). DELETE after 365d. v82.
- `reddit_intel_daily_summary` — Daily lead narrative + `emerging_threats` / `brand_watchlist` JSONB. v82.
- `reddit_processed_posts` — Dedup registry (`feed_item_id`, `external_post_id UNIQUE`).
- `competitor_intel_observations` — Per-scam extractions split out of competitor newsletters by the `competitor-intel-extract` cron (Arthur's Watch Phase 2). One row per distinct scam found in a competitor `feed_items` row. Service-role-only RLS; FK → `feed_items(id)` ON DELETE CASCADE; `UNIQUE(feed_item_id, scam_title)` for idempotent re-runs. Intelligence only — never published (ADR-0021). v212.

### Feedback & Triage (write-hot)

- `verdict_feedback` — User thumbs-up / thumbs-down + reason codes. v47, v66, v67.
- `feedback_triage_queue` `[hot ⚠]` (MV) — Active-learning queue: `triage_score = uncertainty × impact_weight`. Refreshed by 30-min change-guarded cron. v94.

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

### Analytics / Attribution (v190–v191)

- `visitors` — One row per anonymous visitor; **write-once first-touch** attribution (`anonymous_id` PK, `first_utm_*`, `first_referrer`, `first_referring_domain`, `landing_path`, `first_seen_at`). Upserted lazily (ignore-on-conflict, so first touch wins) from the event-write path — **never from middleware**. v190.
- `analytics_events` — Append-only named-event log (`event_type`, `event_props` jsonb, `path`, `utm_*`, `referrer`, `request_id`; FK → `visitors`). **Metadata only — never scanned content, phone numbers, URLs, or images.** Not on the hot-table list; INSERT-only appends, lean btree indexes. v190.
- **Views** (`security_invoker`, read by `/admin/analytics` via service role): `daily_scans`, `scans_by_type`, `scans_new_vs_returning`, `no_scan_visitor_rate`, `utm_attributed_conversions`, `blog_to_scan_funnel` (v190); `content_post_funnel` — per-post content→conversion keyed on first-touch `landing_path` (v191).
- RLS: deny-all default; `service_role` bypass (same posture as `cost_telemetry`). All writes go via the service-role `/api/events` route + `logEvent()`; zero anon-insert. Gated by `FF_ANALYTICS_ATTRIBUTION` (ON in prod 2026-07-05).

### Deepfake / Media

- `deepfake_detections` — Media analysis results (file, hash, deepfake_confidence, predicted_labels). v54.
- `image_check_records` — Metadata-only evidence records for FLAGGED right-click image checks (check_ref, install_id_hash, scores, generator_breakdown, content_credentials, image_sha256 — never bytes; ADR-0022). v239.
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
- `email_copy`, `email_copy_history` — Admin-editable prose "copy slots" for outbound email templates (Email Studio). `email_copy` is the active per-(template,slot) override merged over code defaults by `resolveEmailCopy()`; `email_copy_history` is the append-only audit log. Service-role only. v167.
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
- `blog_external_links` — Curated "Further reading" links per post (nofollow by default; `origin` audits editorial vs outreach vs partnership). Service-role RLS, managed via `/admin/blog`. Policy: `/blog/editorial-policy`. v227.
- `email_subscribers` — Newsletter signup. DENY_ALL RLS (v109).

### Clone-watch / Shopfront

- `shopfront_shops` — Installed Shopify merchant index. Minimal scaffold at MVP. Service-role RLS. v140.
- `shopfront_clone_alerts` — Single write target for ALL clone detections (ADR-0016 Decision #1). Layer 0 writes `target_shop_id IS NULL`, `source = 'nrd'`. CHECK enforces XOR on `target_shop_id` / `inferred_target_domain`. `signals` JSONB array per ADR-0015. UNIQUE expression index on `(COALESCE(target_shop_id::text, inferred_target_domain), url_hash)`. Service-role RLS. v140. **Extended in v143** with triage columns: `triage_status` (CHECK in `'pending'|'tp_confirmed'|'fp'|'needs_investigation'|'tp_actioned'`), `triage_by uuid`, `triage_at timestamptz`, `triage_notes text`, `submitted_to jsonb DEFAULT '{}'::jsonb`. **Extended in v148** with urlscan columns: `urlscan_evidence jsonb`, `urlscan_classification` (CHECK in `'parked_for_sale'|'unresolved'|'likely_phishing'|'neutral'`), `urlscan_scanned_at timestamptz`, `urlscan_uuid text`. Partial indexes: `idx_clone_alerts_triage_pending`, `idx_clone_alerts_urlscan_rescan`. **Extended 2026-07-17:** `campaign_key text` (v235 — coarse actor fingerprint computed in TS by `campaign-fingerprint.ts`, sentinel `'insufficient'`; partial index excluding null/insufficient) + `weaponised_notified_at timestamptz` (v236 — durable weaponised.v1 emit worklist: `weaponised_at NOT NULL AND weaponised_notified_at NULL`, partial index). `attribution` jsonb additively carries `whois.{statuses,registrarIanaId,abuseContact,source}`, `au_registrant`, `kit_siblings` (all flag-gated, no migration).
- `shopfront_takedown_attempts` — DMCA / registrar / Cloudflare / Shopify-abuse log per alert. Unused at Layer 0; populated by Shield Pro tier (#377). Service-role RLS. v140.
- `brand_contact_directory` — Per-brand outreach channel mapping for Layer 3/4. `brand text PRIMARY KEY`; `channel_type text CHECK IN ('bugcrowd_vdp','security_txt','fraud_inbox','contact_form','manual_review','none')`; `legitimate_domain`; `recipient` email or URL; `evidence_format`; `last_notified_at timestamptz` (24h cooldown signal); `notes`. Service-role RLS only. v143 + v143b seed; expanded in v150 (74 → 106 brands); re-routed big-four banks bugcrowd_vdp → fraud_inbox in v155 (real phishing inboxes for NAB/Westpac/ANZ/CBA); silenced 13 no-inbox brands → `none` in v156. **Current distribution (2026-05-28):** manual_review 42, fraud_inbox 41, none 13, contact_form 9, security_txt 1, bugcrowd_vdp 0.
- `clone_alert_notification_queue` — Daily batch queue for Layer 3/4 emails. `id bigserial PK`, `alert_id bigint`, `brand text` (FK → `brand_contact_directory.brand` since v154), `candidate_domain`, `candidate_url`, `recipient`, `channel_type`, `severity_tier`, `scheduled_for timestamptz`, `enqueued_at`, `processed_at`, `batch_id uuid`, `approval_status text` (`unbatched` / `pending` / `approved` / `auto_approved` / `sent` / `rejected` / `expired`), `email_subject`, `email_body_html`, `prepared_at`, `approved_at`, `approval_url`, `provider_message_id`, `approved_by_admin_id uuid`, `rejected_by_admin_id uuid`. UPSERT key `(alert_id, channel_type)`. Service-role RLS only. v151.
- `clone_alert_brand_replies` — Inbound brand-reply tracking (Phase C foundation). Receives parsed reply messages from the planned Cloudflare Worker → Edge Function inbound handler (issue #430). CHECK `from_email = lower(from_email)` enforces lowercase for suppression lookup. Service-role RLS only. v146.
- `clone_watch_scan_transitions` — Append-only archive of urlscan **classification transitions** (written by `persist_clone_alert_urlscan` only when the classification value changes, incl. NULL→first). Preserves before/after evidence that the in-place `urlscan_evidence` overwrite destroys — the weaponisation before/after research + detection-lag source. Caveat: `prior_evidence` at persist time is usually the v224 submit stub; the previous FULL render is the previous transition row's `new_evidence`. Unique dedup index `(alert_id, COALESCE(urlscan_uuid,''), new_classification)` guards Inngest replays. Deny-all RLS, service-role bypass. Tiny (transitions are rare); no retention — revisit at >10k rows. v230.
- **Clone-watch RPCs (24, all SECURITY DEFINER + locked search_path, all `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` unless noted):**

  _Ingest + triage:_
  - `upsert_clone_alerts_batch(JSONB) → INTEGER` — batch INSERT ON CONFLICT for daily NRD ingest. v141.
  - `list_clone_alerts_pending_triage(p_limit INT) → TABLE` — admin dashboard pending queue + urlscan classification + screenshot URL. v143 / v148.
  - `set_clone_alert_triage(p_alert_id BIGINT, p_status TEXT, p_admin_id UUID, p_notes TEXT)` — triage state transition. v143.
  - `merge_clone_alert_submission(p_alert_id, p_key, p_value, p_set_triage_status) → TABLE` — atomic JSONB merge for `submitted_to` to prevent cross-fn races between submit-netcraft / poll-netcraft / notify-brand / triage-route-inline. v147.

  _KPI / public surface:_
  - `clone_watch_weekly_metrics(p_days INT) → TABLE` — KPIs for admin tile + weekly digest. v143.
  - `clone_watch_brand_breakdown(p_days INT) → TABLE` — per-brand history for admin table. v144.
  - `clone_watch_public_impact(p_days INT) → TABLE` — aggregate counts for `/clone-watch` public page. **Anon GRANT** (output is aggregate-only). v144 + revised in v147 (brands_protected semantic fix).
  - `clone_watch_takedown_stats(p_days INT) → TABLE` — median + P90 time-to-takedown. **Anon GRANT**. v145. (Anon grant revoked in v160; read server-side via service client.)
  - `clone_watch_vendor_gap_stats(p_days INT DEFAULT 90) → TABLE` — the "vendor-gap clock": per-leg `(n, median_hours)` for decline→weaponise, weaponise→re-file (`report_issue`), re-file→takedown, full submit→takedown loop. Aggregate-only; service-role only (v160 posture); rendered server-side on `/clone-watch`. Medians NULL when a leg is empty; strict non-negative guards handle the last-touch `netcraft_declined_at` pathology. v231; `search_path=''` hardening v232.
  - `clone_watch_unactioned_age_stats() → TABLE` — age distribution (median/p90/oldest days since `first_seen_at`) of the still-`declined`, still-rendering NRD tail. Live snapshot, service-role only. v231; `search_path=''` hardening v232.

  _URLscan:_
  - `list_clone_alerts_pending_urlscan(p_limit INT) → TABLE` — selector for urlscan initial-scan fan-out. v148.
  - `list_clone_alerts_for_urlscan_rescan(p_limit, p_stale_after_hours) → TABLE` — selector for daily urlscan re-scan cron. v148 + v149 (30→60 day window).
  - `persist_clone_alert_urlscan(p_alert_id, p_urlscan_uuid, p_evidence, p_classification, p_set_triage_status) → TABLE` — atomic persist + never-demote triage transition. v148; failure-streak maintenance v169; **v230** archives a `clone_watch_scan_transitions` row when the classification value changes (signature unchanged).

  _Netcraft polling:_
  - `list_clone_alerts_pending_netcraft_poll(p_limit INT) → TABLE` — selector for Netcraft polling cron. v145.

  _Notification queue (batch-approval flow — v151+):_
  - `enqueue_clone_alert_notification(p_alert_id, p_brand, p_candidate_domain, p_candidate_url, p_recipient, p_channel_type, p_severity_tier, p_scheduled_for)` — UPSERT into queue keyed on `(alert_id, channel_type)`. Called by both notify-brand Inngest fn and (since PR #488) the triage route inline. v151.
  - `list_clone_alerts_unbatched_for_prepare(p_limit INT) → TABLE` — selector for the daily 09:30 UTC prepare cron. v151.
  - `list_recently_notified_brands(p_legitimate_domains TEXT[], p_cooldown_hours INT) → TABLE` — 24h cooldown filter for the prepare cron. v152.
  - `assign_clone_alert_batch(p_queue_ids BIGINT[], p_batch_id UUID, p_email_subject, p_email_body_html, p_approval_url, p_auto_approved BOOL)` — freezes rendered subject + html on the queue rows, transitions to `pending` (or `auto_approved`). v151.
  - `load_clone_alert_batch(p_batch_id UUID) → TABLE` — admin dashboard send-route loader; returns all queue rows for a batch with frozen subject/html. v151.
  - `transition_clone_alert_batch(p_batch_id, p_new_status, p_provider_message_id, p_admin_id) → TABLE(updated_count, observed_status, observed_brand, observed_recipient)` — terminal-state transition with structured race-loser detection. v152.
  - `record_brand_notification_sent(p_batch_id UUID, p_provider_message_id TEXT) → INTEGER` — stamps `brand_contact_directory.last_notified_at` + `submitted_to.brand_notification` for every alert in the batch. **v153 fix**: lookup by `brand` (was `legitimate_domain`, which failed for brands whose name differs from their domain like "Domain").
  - `list_clone_alerts_pending_notification_batch(p_limit INT) → TABLE` — dashboard "approvals" tab selector. v151.
  - `mark_clone_alert_notifications_processed(p_alert_ids BIGINT[])` — terminal write for queue rows whose send completed. v151.
  - `purge_old_clone_alert_queue_rows(p_days INT)` — retention sweep, called by `/api/cron/clone-watch-retention`. v151.
  - `purge_old_fp_clone_alerts(p_days INT)` — retention sweep for false-positive alerts. v151.

  _Inbound brand replies:_
  - `ingest_clone_alert_brand_reply(...)` — called by the future inbound-email handler. v146.
  - `clone_alert_recipient_is_suppressed(p_email TEXT) → BOOLEAN` — STOP-suppression check called by notify-brand + the triage route inline + the dashboard send route. v146.

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
| `image_check_records_archive`        | `image_check_records`        | >365d                          | v239                                  |
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

## RPCs (90 total — all `SECURITY DEFINER`)

### Analysis pipeline

- `create_scam_report(...)` — Insert report row, return PK. Source of truth for v21 intelligence core. ON CONFLICT idempotent via v73 `idempotency_key`.
- `upsert_scam_entity(...)` — Insert / bump entity, return `{entity_id, is_new}`. Idempotent.
- `link_report_entity(...)` — M-to-many junction. Idempotent `ON CONFLICT (report_id, entity_id, role)`.
- `report_scam_entity(...)` — Public report-a-scam-contact entry point onto the unified `scam_entities` model. Upserts the entity (phone / email) + bumps `report_count`, optionally links to a `scam_report`, returns `report_count`. Backs `/api/scam-contacts/report` + `/api/extension/report-email` (`/api/scam-contacts/lookup` reads `scam_entities` directly); replaces the dropped `upsert_scam_contact` path. `/api/scam-urls/report` is separate (still `upsert_scam_url`). v170.
- `upsert_scam_url(...)` — Feed-specific entity upsert.
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

- `refresh_feedback_triage_queue()` — `REFRESH MATERIALIZED VIEW CONCURRENTLY feedback_triage_queue`. Service-role only. Called by `feedback-triage-refresh` cron (30 min, change-guarded — most ticks early-exit without refreshing).

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
- `get_jurisdiction_summary(country_code, ...)` — World-stats dashboard source. v60.
- `get_world_scam_stats(...)` — Per-country scam counts (scam_entities + scam_urls + feed_items); backs the `/scam-map` + `/about` world maps via `getWorldStats()`. The v60 definition was **never live in prod**; restored in **v171 (#562)** as `SECURITY DEFINER` + `SET search_path = ''`, `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`, `GRANT service_role`.

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

| Pattern                            | Example tables                                                | Shape                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Service-role only**              | `breach_victims_index`, `feed_http_cache`, archive shadows    | `USING(auth.role() = 'service_role')`. Public access goes through a SECURITY DEFINER RPC.                                                                                                                                                                                                                                          |
| **Public read, service write**     | `verified_scams`, `feed_items`, `acnc_charities`              | `USING(true)` for SELECT. INSERT/UPDATE/DELETE restricted to service role. Write-once data.                                                                                                                                                                                                                                        |
| **Service-role only (since v172)** | `scam_reports`, `scam_entities`, `report_entity_links`        | Anon Public-read **removed in v172 (#566), applied 2026-05-30** — closed a bulk-export hole (raw scammer phone/email leaked via `/rest/v1/scam_entities?select=*`). RLS enabled with no SELECT policy → anon/authenticated denied, service_role bypasses. Readers are service_role / the rate-limited `/api/scam-contacts/lookup`. |
| **Org-scoped multi-policy**        | `api_keys`, `phone_footprint_monitors`                        | 4 policies (select/insert/update/delete) joining `org_members`. User can see own + org members'; staff+ for CUD.                                                                                                                                                                                                                   |
| **Explicit DENY** (v109)           | `email_subscribers`, `verdict_feedback`, `feed_ingestion_log` | Deny anon + authenticated. Service-role-only via trigger from frontend RPC.                                                                                                                                                                                                                                                        |

Audit waves:

- **v104** — security-definer lockdown across all RPCs (prevents unprivileged callers from escalating privilege).
- **v106** — `USING(true)` rewrite (explicit, not implicit).
- **v107** — multi-permissive policy consolidation (merge redundant PERMISSIVE policies into one with explicit `TO` clause).
- **v109** — explicit DENY policies on sensitive tables.

---

## Migration timeline (v2 → v229)

Approximate domain bundling:

| Range     | Theme                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v2–v9     | Core bootstrap (users, verified_scams, blog_posts, api_keys, scan_results)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| v10–v13   | Pipeline core (bot_message_queue, feed_items, feed_ingestion_log, scam_urls)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| v14–v20   | Entity + audit (scam_ips, scam_crypto_wallets, sites, site_audits)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| v21–v23   | Intelligence core (scam_reports, scam_entities, report_entity_links, clusters)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| v24–v30   | Scoring + billing (api_tiers, subscriptions, api_keys evolution)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| v31–v35   | Auth + reputation (auth.users trigger, push_tokens, phone_reputation)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| v36–v48   | Feed expansion (reddit_feed, threat_intel_exports, feed_summaries, brand_alerts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| v49–v60   | Deepfake + org (flagged_ads, deepfake_detections, organizations, leads, fraud_manager)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| v61–v68   | Telemetry + archive (cost_telemetry, feature_brakes, verdict_feedback, archival shadows)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| v69–v77   | Phone Footprint ships + RLS tightening                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| v78–v90   | Breach Defence + Embeddings (breaches, breach_victims_index, HNSW on scam_reports/verified_scams)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| v91–v99   | Reddit Intel + News Intel narratives + retention                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| v100–v107 | DB hygiene + RLS standardisation (FK indexes, DENY_ALL, multi-permissive consolidation)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| v108–v122 | Refinement + sibling tables (cost_telemetry_daily_rollup, acnc_charity_embeddings)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| v123–v139 | SIM-swap + admin-auth + Phase B threat-intel scrapers + analyze observability                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| v140–v149 | Clone-watch core: shopfront_clone_alerts (v140) → ingest RPC (v141) → triage columns + directory seed (v143/v143b) → KPI RPCs (v144/v145) → inbound replies (v146) → atomic JSONB merge (v147) → urlscan evidence (v148) → 60-day rescan window (v149)                                                                                                                                                                                                                                                                                                                                                 |
| v150–v156 | Clone-watch outreach hardening: directory expansion to 106 brands (v150); notification queue + batch-approval RPCs (v151); cost-brake-aware send + cooldown + race-loser detection (v152); `record_brand_notification_sent` lookup-by-brand fix (v153); FK `clone_alert_notification_queue.brand → brand_contact_directory.brand` + 5 orphan cleanup (v154); big-four banks bugcrowd_vdp → fraud_inbox with real phishing inboxes (v155); silence 13 no-inbox brands → `none` channel (v156).                                                                                                          |
| v157–v172 | Clone-watch preclassify selectors + public revoke sweep (v157–v160); entity enrichment merge / risk-score batch / cluster commit (v161–v163); retention chunking + timeout caps (v164); onward OpenPhish/APWG enum + Brand Stewardship reports + Email Studio copy slots (v165–v167); blog slug unique + clone-watch urlscan failure-streak (v168–v169); `report_scam_entity` public RPC (v170); restore `get_world_scam_stats` (v171, #562); anon-RLS tighten — drop anon Public-read on `scam_entities`/`scam_reports`/`report_entity_links` (v172, #566, **HELD — not yet applied to prod**).       |
| v173–v191 | Vulnerability mentions (v173); canonical brand-alias layer (v174–v176); clone-alert attribution + urlscan async (v177–v178); known-brands contact seed (v179); brand-stewardship share-token / unsubscribes / outreach-done (v181–v183); Netcraft auto-candidates + daily cap (v184–v185); clone-watch report summary (v189); **first-party analytics** — `visitors` + `analytics_events` + 6 attribution views (v190, #666), `content_post_funnel` per-post view (v191, #667).                                                                                                                        |
| v192–v207 | Shop Signal reviews + brand-convergence Seam + analytics/attribution refinements (see BACKLOG / memory for the per-migration detail).                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| v215–v229 | **Clone-watch brand-value + blog surface.** Clone-watch F1–F5 stack (v215–v226, see `docs/plans/clone-watch-brand-value-features.md`); blog `blog_external_links` (v227), Ghost-mirror partial-index fix (v228), and `idx_analytics_events_pageview_path` — a partial btree `analytics_events(path) WHERE event_type='pageview'` backing the on-page blog view count `getPostViewCount()` (v229, PR #748). This index reads as "unused" in advisors until blog traffic + hourly ISR regen exercise it.                                                                                                 |
| v208–v214 | **Weekly Intel + Arthur's Watch stack.** Dynamic weekly-digest synthesis store `reddit_intel_weekly_digest` (v208, PR #699); then Arthur's Watch competitor-newsletter intelligence — `feed_items.source` class extension (v209), `competitor_intel` category constraint (v210), remove dormant `inbound_twis` (v211), `competitor_intel_observations` per-scam extraction table (v212), +6 inbound sources (5 competitor + `wa_scamnet` regulator, v213), `feed_items.competitor_extracted_at` attempt marker (v214). See ADR-0021 + `docs/plans/arthurs-watch-newsletter.md`.                        |
| v230–v237 | **Reporting metrics + stabilisation + registrant intel (2026-07-16/17).** Clone-watch reporting-metrics archive (v230–v233). Then: v234 fixes three chronic cron failures (partition helpers → SECURITY DEFINER + self-heal + RLS-on-partitions; `mark_stale_ips` → bounded batch); v235 campaign fingerprinting (`shopfront_clone_alerts.campaign_key` + `clone_campaigns_for_brand(brand, since, until)` RPC — service-role, `HAVING count(*) >= 2`); v236 `weaponised_notified_at` durable weaponised.v1 emit worklist; v237 `mark_stale_ips` search_path hardening (empty path + qualified names). |

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
| `feedback_triage_queue` | No (MV refreshed 30-min)           | No embedding; `triage_score` REAL only. Indexes: `feedback_id UNIQUE`, `triage_score`.                                                             |
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

---

## Generated TypeScript types

The `public` schema is mirrored into TypeScript at `packages/types/src/db.generated.ts` and re-exported as `Database`, `Tables<>`, `TablesInsert<>`, `TablesUpdate<>`, `Enums<>` from `@askarthur/types`. Consumers can write `Tables<'feedback_triage_queue'>` instead of hand-maintaining a row interface that drifts the moment a column is added.

**Regeneration command** (requires `SUPABASE_ACCESS_TOKEN` in environment):

```bash
pnpm --filter @askarthur/types gen:db
```

**When to regenerate** — after any migration that:

- adds or renames a column on a `public` table or materialized view,
- changes an enum's value list,
- changes the argument list or return shape of a `public` RPC.

The generated file is committed (NOT git-ignored) so CI typechecks have access to it without needing the Supabase CLI or an access token. The trade-off: every regen produces a sizeable diff that must land in the same PR as the migration that prompted it.

**Pilot file** — `apps/web/app/admin/feedback/page.tsx` uses `Tables<'feedback_triage_queue'>` as the base for its `TriageRow` shape and narrows nullability + enum strings at the page boundary with a runtime type guard. Use this pattern (boundary narrowing, no `as` casts) when the MV/view row's nullability is wider than the consumer expects.
