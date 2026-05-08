# Data retention reference

Authoritative list of every table that has, or deliberately doesn't have, automatic retention. Update when new tables are added — the systemic failure mode this catches is "feature X writes a high-velocity table and nobody adds retention for it."

Last updated: 2026-05-08 (v113).

---

## Nightly retention pipeline (Inngest)

Five Inngest cron functions run in dependency order each night. All use `createServiceClient()` and the SECURITY DEFINER pruning RPCs (anon/authenticated EXECUTE revoked in v104/v110).

| Time UTC | Function | Action | Source |
|---|---|---|---|
| 02:30 | `feed-retention` | Archive `feed_items` >365d (regulator narratives only) → `feed_items_archive`; prune `feed_ingestion_log` >90d; prune `feed_http_cache` >30d | `packages/scam-engine/src/inngest/feed-retention.ts` |
| 03:15 | `phone-footprint-retention` | Anonymise `phone_footprints` (>7d post-`expires_at`); lapse `phone_footprint_monitors` past `consent_expires_at` | `packages/scam-engine/src/inngest/phone-footprint-retention.ts` |
| 03:45 | `reddit-processed-posts-retention` | Delete `reddit_processed_posts` >30d (dedup tracker only) | `packages/scam-engine/src/inngest/reddit-processed-posts-retention.ts` |
| 04:00 | `cost-telemetry-retention` | Refresh `cost_telemetry_daily_rollup` (last 7 days); delete raw `cost_telemetry` >90d | `packages/scam-engine/src/inngest/cost-telemetry-retention.ts` |
| 04:30 | `telco-events-retention` | Prune 7 telco tables (730d for sim/device swap events; 365d others) | `packages/scam-engine/src/inngest/telco-events-retention.ts` |

## Per-table retention status

| Table | Retention | Mechanism | Notes |
|---|---|---|---|
| `feed_items` | Hot 365d → archive (regulator narratives only) | v98 `archive_feed_items_batch()` | Reddit / user_report / verified_scam rows kept indefinitely |
| `feed_items_archive` | None | — | Cold tier; could move to R2 Parquet (Phase 6) |
| `feed_ingestion_log` | 90d hard delete | v98 `prune_feed_ingestion_log()` | Scraper run telemetry |
| `feed_http_cache` | 30d hard delete | v98 `prune_feed_http_cache()` | ETag/Last-Modified shortcut |
| `scam_reports` | 90d hot, archive 90/180d (HIGH_RISK longer) → `scam_reports_archive` | v68 `archive_scam_reports_batch()` | Cron `/api/cron/scam-reports-retention` |
| `report_entity_links` | Cascade-archive with parent | v68 same RPC | |
| `scam_reports_archive` | None | — | Cold tier |
| `cluster_reports_archive` | None | — | Cold tier |
| `phone_footprints` | Anonymise 7d post-`expires_at` | v75 `anonymise_expired_footprints()` | NULLs PII, sets `anonymised_at` |
| `phone_footprint_monitors` | Lapse status past `consent_expires_at` | v75 `sweep_inactive_monitors()` | UPDATE only — rows kept for audit |
| `phone_footprint_otp_attempts` | 365d hard delete | v113 `prune_telco_events()` | OTP forensics |
| `phone_lookups` | 365d | v113 same | Twilio Lookup forensic trail |
| `sim_swap_events` | 730d | v113 same | Forensic — fraud investigation lookbacks |
| `device_swap_events` | 730d | v113 same | Forensic |
| `subscriber_match_checks` | 365d | v113 same | CAMARA verification trail |
| `telco_signal_history` | 365d | v113 same | Provider health time-series |
| `telco_api_usage` | 365d | v113 same | Vonage billing reconciliation (13mo at provider) |
| `cost_telemetry` | 90d hot raw → daily rollup forever | v112 `prune_cost_telemetry()` + `cost_telemetry_daily_rollup` | Long-range queries hit the rollup table |
| `cost_telemetry_daily_rollup` | None (bounded growth) | — | ~10 rows/day × 365d × N years; ~3.6k/year |
| `reddit_processed_posts` | 30d hard delete | `cleanup_old_reddit_posts()` | Dedup tracker only |
| `reddit_post_intel` (narrative cols) | NULL after 180d | `/api/cron/reddit-intel-retention` | Structured fields kept indefinitely |
| `reddit_intel_quotes` | 365d hard delete | same cron, stage 2 | Reddit ToS — quotes ≤140 chars only |
| `vulnerability_detections` | 180d EXCEPT KEV / `exploited_in_wild` | `/api/cron/vuln-retention` | CISA KEV exempt |
| `bot_message_queue` | 24h terminal / 48h pending | `/api/cron/bot-queue-cleanup` | PII null-out on terminal-state writes |

## Tables explicitly with NO retention (intentional)

| Table | Reason |
|---|---|
| `scam_entities` | Threat-intel reference data; lifetime value |
| `scam_clusters`, `cluster_members` | Aggregate denormalisations of `scam_reports` |
| `verified_scams` | Curated high-confidence scam library |
| `acnc_charities` | External register mirror; rebuilt weekly |
| `breaches`, `breach_victims_index` | Per-incident records — kept indefinitely for HIBP-style lookups |
| `subscriptions`, `stripe_event_log` | Billing audit trail; ATO/tax reasons retain ≥7y |
| `feature_brakes` | Bounded (≤20 rows ever); self-expiring via `paused_until` |
| `extension_installs` | Extension fingerprint registry; revocation rather than delete |
| `organizations`, `org_members`, `user_profiles` | Tenant identity; deletion is a separate explicit flow |

## Tables that SHOULD have retention but don't yet

These are tracked in the data-model improvement plan as Phase 2.5 (`*_archive` shadow + retention RPC). Append-only, smaller volumes, but accumulating:

- `flagged_ads`
- `deepfake_detections`
- `media_analyses`
- `scan_results`
- `verdict_feedback`
- `brand_impersonation_alerts`

When Phase 2.5 lands, update the table above.

## Operational notes

- **Retention is destructive.** Every RPC has been verified to only delete rows older than the documented window AND not affected by FK cascades. New retention RPCs MUST add a Inngest cron registration (see `packages/scam-engine/src/inngest/functions.ts`) and update this doc.
- **Bounded-batch pattern.** High-volume retention (e.g. `archive_scam_reports_batch`, `archive_feed_items_batch`) loops 5000-row batches with a hard iteration cap to avoid long-running transactions blocking autovacuum.
- **Anonymisation > deletion for PII.** `phone_footprints` is the canonical pattern — UPDATE to `'REDACTED'` + clear JSONB blobs + set `anonymised_at`. Audit trail of who-was-monitored stays; the PII goes.
- **All retention RPCs are idempotent.** Re-running a prune the next night just deletes nothing (window already enforced).

## Adding retention for a new table

Checklist when shipping a high-velocity table:

1. **Pick a window.** Forensic (fraud / chain-of-custody): 730d. Operational telemetry: 365d. Cache / ETag / dedup: 30–90d.
2. **Pick a mechanism.** Pure DELETE (default). Archive shadow (when historical query is plausible — see v68/v98 patterns). Anonymise (when row is needed for audit but PII isn't — phone_footprints pattern).
3. **Write the RPC.** SECURITY DEFINER, `SET search_path = public, pg_catalog`, GRANT EXECUTE TO service_role only, REVOKE from PUBLIC/anon/authenticated.
4. **Wire the cron.** Clone an existing Inngest function; pick a slot in the 02:30 / 03:15 / 03:45 / 04:00 / 04:30 nightly tier.
5. **Update this doc.**

## References

- Migration history: `supabase/migration-v68-retention-archive.sql`, `migration-v98-feed-retention.sql`, `migration-v75-phone-footprint-core.sql`, `migration-v112-cost-telemetry-retention.sql`, `migration-v113-telco-event-retention.sql`.
- BACKLOG.md → Database Hygiene & SPF Readiness (residual items).
- Data-model improvement plan: `~/.claude/plans/prancy-strolling-dongarra.md` (Phase 2 covers retention).
