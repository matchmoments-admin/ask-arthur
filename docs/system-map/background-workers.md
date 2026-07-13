# Ask Arthur — Background Workers

Everything that runs without a user request: Vercel crons, Inngest functions, Python scrapers (GitHub Actions), and the Supabase pg_net database webhook for bot dispatch.

**Critical rules** (from `CLAUDE.md`):

- Any worker that writes to a hot table (`acnc_charities`, `scam_reports`, `verified_scams`, `feedback_triage_queue`, `feed_items`, `scam_entities`) must chunk at ≤5K rows per iteration with a finite `statement_timeout` (e.g., `'300s'`). Born from incident 2026-05-09.
- Any worker that could exceed 10 min triggers the `pg-stuck-query-watchdog` Telegram page. Chunk it, or document the expected duration in the function header.
- Long-running write loops follow the chunked-retryable pattern in `pipeline/scrapers/acnc_register.py` (post-PR #187).

---

## Vercel crons (16)

Defined in `apps/web/vercel.json`. All routes verify the Vercel cron signature.

| Path                                | Schedule                       | Purpose                                    |
| ----------------------------------- | ------------------------------ | ------------------------------------------ |
| `/api/cron/weekly-blog`             | `0 12 * * 1` (Mon 12:00 UTC)   | Weekly blog digest                         |
| `/api/cron/weekly-email`            | `0 14 * * 1` (Mon 14:00 UTC)   | Weekly scam digest email                   |
| `/api/cron/nurture`                 | `0 23 * * *` (daily 23:00 UTC) | B2B leads nurture sequence                 |
| `/api/cron/bot-queue-sweep`         | `0 */6 * * *` (every 6h)       | Bot queue safety net (>2 min pending)      |
| `/api/cron/bot-queue-cleanup`       | `0 4 * * *` (daily 04:00 UTC)  | Hard-delete terminal queue rows >24h       |
| `/api/cron/cost-daily-check`        | `0 */6 * * *` (every 6h)       | Cost threshold alert + brake gate          |
| `/api/cron/cost-weekly-digest`      | `0 22 * * 0` (Sun 22:00 UTC)   | WoW cost report to Telegram                |
| `/api/cron/vuln-retention`          | `0 3 * * *` (daily 03:00 UTC)  | Prune `vulnerability_detections` >180d     |
| `/api/cron/scam-reports-retention`  | `30 3 * * *` (daily 03:30 UTC) | Archive `scam_reports` + prune shadows     |
| `/api/cron/ensure-partitions`       | `0 2 * * *` (daily 02:00 UTC)  | Create next-month partitions               |
| `/api/cron/reddit-intel-trigger`    | `0 8 * * *` (daily 08:00 UTC)  | Poll `feed_items` for Reddit batches       |
| `/api/cron/reddit-intel-retention`  | `30 4 * * *` (daily 04:30 UTC) | Prune `reddit_processed_posts` dedup table |
| `/api/cron/feedback-digest`         | `0 9 * * *` (daily 09:00 UTC)  | Verdict-feedback audit report              |
| `/api/cron/health-digest`           | `0 22 * * *` (daily 22:00 UTC) | Daily health + errors to Telegram          |
| `/api/cron/pg-stuck-query-watchdog` | `*/5 * * * *` (every 5 min)    | Alert + kill long-running queries          |
| `/api/cron/scraper-brake-alert`     | `*/15 * * * *` (every 15 min)  | Monitor `feature_brakes` activation        |

---

## Inngest functions (75)

Registered in `apps/web/app/api/inngest/route.ts` via `serve({ functions: [...inngestFunctions, ...appFunctions] })`, so the count is the sum of **two** arrays — don't count from one file:

- **29** in `packages/scam-engine/src/inngest/functions.ts` (`inngestFunctions`) — enrichment, embeddings, reddit-intel, retention that predates the apps/web split.
- **46** in `apps/web/app/api/inngest/route.ts` (`appFunctions`) — phone-footprint, onward-reporting, clone-watch, brand-stewardship, and the housekeeping crons moved here in #588.

To re-derive after adding/removing a function, count non-comment entries in both arrays (last verified 2026-07-13 after the fleet-review adds/removals: +D3 `onDemandUrlEnrich`, −`ctMonitor`, −`metaBrpEnrich`). All have idempotency keys based on `event.data.requestId` (24h dedup); cron functions use Inngest's native cron dedup.

**Production-only cron guard.** `withAxiomLogging` skips any `inngest/scheduled.timer` (cron) tick on a non-production deployment, so only the prod deployment runs scheduled work. Inngest provisions a separate branch environment per Vercel preview, and previews inherit the prod secrets (admin Telegram chat id, Supabase service key) — without the guard, every open preview fired all crons into the prod admin chat and against the prod DB (the cause of the duplicate "Known-brands discovery" / "Reddit brands discover" Telegram bursts). Event and manual triggers still run in preview for testing; set `INNGEST_ALLOW_NONPROD_CRONS=true` on a deployment to force a cron to run off-prod. The check is `isProductionDeployment()` (`@askarthur/utils/env`, `VERCEL_ENV === "production"`).

All registered functions are wrapped in `withAxiomLogging` (#553 / #565); actual log emission is gated by `FF_AXIOM_ENABLED`, which is **ON in prod + preview since 2026-05-29** (was default-OFF before). The `ask-arthur` Axiom dataset (`NEXT_PUBLIC_AXIOM_DATASET`) was created 2026-05-31 and the ingest path verified end-to-end — Axiom does not auto-create datasets, so until it existed the lifecycle logs were silently dropped at the destination.

### Analyze pipeline (fan-out on `analyze.completed.v1`)

| Function                     | Trigger                                     | Purpose                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analyze-completed-report`   | `analyze.completed.v1`                      | Store `scam_reports` row + entity links via `create_scam_report` RPC                                                                                                                                                                |
| `analyze-completed-brand`    | `analyze.completed.v1`                      | Create `brand_impersonation_alerts` row when `impersonatedBrand` present                                                                                                                                                            |
| `analyze-completed-cost`     | `analyze.completed.v1`                      | Log `cost_telemetry` row tagged by source + token counts                                                                                                                                                                            |
| `analyze-failure-subscriber` | `inngest/function.failed` (prefix-filtered) | Log analyze pipeline failures                                                                                                                                                                                                       |
| `on-demand-url-enrich`       | `analyze.completed.v1`                      | D3: enrich the specific `scam_urls` rows for a checked URL if still pending (WHOIS/SSL) — closes the residual gap the newest-first enrichment cron can't reach. `dataPipeline`-gated, `requestId`-idempotent, zero analyze latency. |

Gated by `FF_ANALYZE_INNGEST_WEB`. When false, the legacy `waitUntil` path runs inline in `/api/analyze`.

### Enrichment pipeline (recurring)

| Function                      | Cron           | Purpose                                                                  |
| ----------------------------- | -------------- | ------------------------------------------------------------------------ |
| `pipeline-enrichment-fanout`  | `0 */12 * * *` | URL WHOIS + SSL enrichment (20 domains/run, concurrency 1, newest-first) |
| `pipeline-entity-enrichment`  | `0 */8 * * *`  | Entity enrichment (wallet / IP / email)                                  |
| `pipeline-urlscan-enrichment` | `30 */8 * * *` | URLScan async enrichment                                                 |

### Staleness checks (daily 03:00 UTC)

| Function                           | Purpose                             |
| ---------------------------------- | ----------------------------------- |
| `pipeline-staleness-check`         | Mark URLs inactive after 7 days     |
| `pipeline-staleness-check-ips`     | Mark IPs inactive after 7 days      |
| `pipeline-staleness-check-wallets` | Mark wallets inactive after 14 days |

### Vulnerability enrichment

| Function                          | Trigger                              | Purpose                                                                                          |
| --------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `enrich-vulnerability-au-context` | `vulnerability.created.v1` (per-CVE) | Haiku enrichment: `banks_affected`, `gov_affected`, Essential Eight relevance. Cost-brake gated. |
| `enrich-vulnerabilities-cron`     | `0 * * * *` (hourly)                 | Batch enrichment of unprocessed vulnerabilities                                                  |

### Reddit Intel pipeline

| Function               | Trigger                       | Purpose                                        |
| ---------------------- | ----------------------------- | ---------------------------------------------- |
| `reddit-intel-daily`   | `reddit.intel.batch_ready.v1` | Classify + summarise Reddit posts (Sonnet 4.6) |
| `reddit-intel-embed`   | `reddit.intel.summarised.v1`  | Embed narratives via Voyage 3                  |
| `reddit-intel-cluster` | `reddit.intel.embedded.v1`    | Cluster posts → themes (greedy cosine ≥ 0.78)  |

### Scam alerts & embed

| Function                      | Trigger                     | Purpose                                                                                                                                                                                                 |
| ----------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scam-alert-push`             | `0 */3 * * *` (every 3h)    | HIGH-confidence threat push notifications                                                                                                                                                               |
| `scam-report-embed`           | `scam-report.stored.v1`     | Embed user reports for clustering                                                                                                                                                                       |
| `scam-reports-backfill-embed` | `30 5 * * *` + manual event | Steady-state verified_scams embed delta (scam_reports embed synchronously via `scam-report.stored.v1`; verified_scams had no sync path — 2026-07-12) + historical backfill. Brake: `scam_report_embed`. |

### News Intel (regulator narratives)

| Function                   | Trigger                          | Purpose                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feed-items-embed`         | `0 * * * *` (hourly)             | Embed Scamwatch / ACSC / ASIC narratives via Voyage                                                                                                                                                                                                                                                                                                       |
| `competitor-intel-extract` | `0 */6 * * *` (every 6h)         | Arthur's Watch Phase 2 — split competitor newsletters into per-scam observations (`competitor_intel_observations`, v212). Flag-gated `FF_COMPETITOR_INTEL_EXTRACT` (default OFF); marks `feed_items.competitor_extracted_at`; logs `cost_telemetry` `feature='competitor-intel-extract'` + shares `feature_brakes.reddit_intel` / `REDDIT_INTEL_CAP_USD`. |
| `feed-retention`           | `30 2 * * *` (nightly 02:30 UTC) | Archive `feed_items` >365d + prune `feed_ingestion_log` (90d) + prune `feed_http_cache` (30d)                                                                                                                                                                                                                                                             |
| `feed-sync-verified-scams` | `0 7 * * 0` (Sun 07:00 UTC)      | Sync `verified_scams` → `feed_items`                                                                                                                                                                                                                                                                                                                      |
| `feed-sync-user-reports`   | `0 7 * * 0` (Sun 07:00 UTC)      | Sync `scam_reports` → `feed_items`                                                                                                                                                                                                                                                                                                                        |
| `regulator-alert-push`     | `0 * * * *` (hourly)             | Push new ASIC / Scamwatch / ACSC alerts to opted-in users (LOOKBACK_MINUTES 75 covers the wider cadence)                                                                                                                                                                                                                                                  |

### Charity Check

| Function                      | Trigger                         | Purpose                                   |
| ----------------------------- | ------------------------------- | ----------------------------------------- |
| `acnc-charity-backfill-embed` | `0 4 * * *` (nightly 04:00 UTC) | Backfill ACNC embeddings to sibling table |

### Phone Footprint

| Function                          | Trigger                                   | Purpose                               |
| --------------------------------- | ----------------------------------------- | ------------------------------------- |
| `phone-footprint-refresh-claimer` | `0 * * * *` (hourly, TZ=Australia/Sydney) | Claim due monitors from refresh queue |
| `phone-footprint-refresh-monitor` | `phone-footprint/refresh.monitor.v1`      | Stage-2 monitor execution             |
| `phone-footprint-pdf-render`      | `pdf-export.requested.v1`                 | PDF render on request → R2 upload     |

### Housekeeping (nightly)

| Function                           | Cron                     | Purpose                                                    |
| ---------------------------------- | ------------------------ | ---------------------------------------------------------- |
| `billing-ingest-nightly`           | `0 2 * * *` (02:00 UTC)  | Per-provider daily infra-spend → `infra_cost_daily` (v134) |
| `cost-telemetry-retention`         | `0 4 * * *` (04:00 UTC)  | Daily rollup + 90d prune                                   |
| `phone-footprint-retention`        | `15 3 * * *` (03:15 UTC) | Anonymise old monitors + sweep consent expiry              |
| `reddit-processed-posts-retention` | `45 3 * * *` (03:45 UTC) | Prune dedup table (30-day window)                          |
| `telco-events-retention`           | `30 4 * * *` (04:30 UTC) | Prune telco events (730d SIM/device, 365d others)          |
| `archive-shadows-retention`        | `0 5 * * *` (05:00 UTC)  | Archive 6 medium-volume tables                             |

### Cluster & risk

| Function                   | Cron                     | Purpose                                  |
| -------------------------- | ------------------------ | ---------------------------------------- |
| `pipeline-cluster-builder` | `0 4 * * *` (04:00 UTC)  | Cluster `scam_reports` → `scam_clusters` |
| `pipeline-risk-scorer`     | `0 */6 * * *` (every 6h) | Score entities by exposure               |

### Feedback learning

| Function                  | Cron                          | Purpose                                                                                                                                                |
| ------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `feedback-triage-refresh` | `*/30 * * * *` (every 30 min) | `REFRESH MATERIALIZED VIEW CONCURRENTLY feedback_triage_queue` — change-guarded (most ticks early-exit without refreshing) + singleton (`mode:'skip'`) |

### Metadata / external

`meta-brp-report` (Meta Brand Rights Protection deepfake reporter) was deregistered in PR #552 and **fully removed 2026-07-13** (fleet review): a pure stub that never ran (unregistered, `deepfake_detections` empty all-time, Graph-API call commented out, footgun #519), it saved 0 step-runs. The source file, its `metaBrpReporter` feature flag, and doc references are gone; resurrect from git history (`git revert`) if deepfake→Meta BRP reporting is ever built. Same PR retired `pipeline-ct-monitor` (below).

`pipeline-ct-monitor` (CT-log brand-impersonation sweep) was **retired 2026-07-13** (fleet review): 0 attributable `scam_urls` rows all-time — crt.sh's JSON endpoint 502s the lightweight access pattern, and the Python `crtsh` scraper already provides CT coverage (~4,970 rows). The Inngest fn + its registration are removed; the pure keyword-config helper `getCtMonitorConfig` (+ tests) is retained in `@askarthur/shopfront-glue` for a future rebuild.

### Onward reporting (event-driven + producer/report crons)

| Function                        | Trigger                                                        | Purpose                                                                                                                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report-onward-markers`         | `report.onward.{scamwatch,reportcyber,idcare,ask_arthur_feed}` | Deep-link / audit markers — one multi-trigger fn (consolidated 2026-07-12 fleet review). Scamwatch/ReportCyber = deep-link `skipped`; IDCARE = phone-handoff `skipped`; Ask-Arthur-feed = audit `sent` (feed write happens via `/api/scam-contacts/report`). No external API. |
| `report-onward-acma-email-spam` | `report.onward.acma_email_spam`                                | ACMA email-spam intake (`FF_ONWARD_ACMA`, default OFF)                                                                                                                                                                                                                        |
| `onward-brand-abuse`            | `report.submitted.v1` (brand abuse)                            | Queue brand report submission                                                                                                                                                                                                                                                 |
| `report-onward-openphish`       | `report.onward.openphish`                                      | Email phishing URL(s) to OpenPhish (`FF_ONWARD_OPENPHISH`, default OFF)                                                                                                                                                                                                       |
| `report-onward-apwg`            | `report.onward.apwg`                                           | Email phishing URL(s) to APWG eCrime Exchange (`FF_ONWARD_APWG`, default OFF)                                                                                                                                                                                                 |
| `report-onward-auto-report`     | `25 */3 * * *` (every 3h)                                      | Proactive producer: sweeps recent HIGH_RISK `scam_reports` with a URL → auto-enqueues OpenPhish/APWG onward reports (`FF_ONWARD_AUTO_REPORT`, default OFF; only enqueues destinations whose worker flag is ON). 24h lookback + dedup index make the 3h cadence lossless.      |
| `report-brand-stewardship`      | `0 9 1 * *` (1st of month)                                     | WS2-cap: aggregate prior month's `onward_report_log` per impersonated brand → UPSERT `brand_stewardship_reports` ledger rows (brands with a `known_brands` email contact). Gated by `FF_BRAND_STEWARDSHIP_REPORT`. TS aggregation, bounded read.                              |

### Shopfront clone-watch (Layer 0 + outreach + measurement)

Layer 0 daily NRD ingest live since 2026-05-24. Outreach pipeline + measurement closure landed across PRs #424 / #425 / #431 / #432 / #433, then hardened across PRs #468 / #469 / #475 / #476 / #482 / #483 / #486 / #487 / #488 / #489 (admin-auth + bank-channel routing + inline-enqueue + URLscan-embedded evidence). The batch-approval flow (queue → prepare → admin click → Resend) replaced the original "send immediately on triage" model on 2026-05-26. All gated by `FF_SHOPFRONT_CLONE_*` flags (see `feature-flags.md`).

| Function                               | Trigger                                                                      | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shopfront-nrd-daily-ingest`           | cron `30 8 * * *` + `shopfront/nrd.manual-trigger.v1`                        | Layer 0 — downloads whoisds NRD zip, lexical-matches against ~50 AU brand watchlist, UPSERTs into `shopfront_clone_alerts`, sends Telegram digest. Then fans out urlscan-requested events.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `shopfront-clone-submit-netcraft`      | event `shopfront/clone.triaged.v1`                                           | Layer 2 — submits TP-confirmed candidates to Netcraft v3 Report API. Skips if `FF_SHOPFRONT_CLONE_SUBMIT_NETCRAFT` OFF or `NETCRAFT_REPORT_API_KEY` unset.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `shopfront-clone-notify-brand`         | event `shopfront/clone.triaged.v1`                                           | Layers 3+4 router (no longer sends email directly — see prepare cron below). Looks up `brand_contact_directory`, then: email channels (`security_txt` / `fraud_inbox`) → `enqueue_clone_alert_notification` into the daily-batch queue; manual channels (`bugcrowd_vdp` / `contact_form` / `manual_review`) → Telegram-page admin via `brand_notification_queued` key; `none` → silently skip. Idempotency `event.data.alertId`. As of PR #488 the triage route inlines the email-channel enqueue, so this function is the redundant safety net for that branch — still load-bearing for manual channels.                                                                                                                                                                                                                        |
| `shopfront-clone-notify-brand-prepare` | cron `30 9 * * *` + `shopfront/clone.notify-brand-prepare.manual-trigger.v1` | **Daily batch builder.** Pulls `unbatched` queue rows where `scheduled_for <= now()`; filters via `list_recently_notified_brands` (24h cooldown); caps at 50 candidates per (brand, recipient) group; mints a batch_id inside `step.run` (replay-safe); fetches `urlscan_evidence` per alert (PR #489 — link + screenshot embedded in email); renders email via React Email; calls `assign_clone_alert_batch` to freeze subject + html on the queue row. When `FF_SHOPFRONT_CLONE_NOTIFY_BRAND_AUTO_SEND=true`: dispatches via Resend on the same tick with `idempotencyKey: clone-watch-send:{batchId}`. Otherwise: rows transition to `pending` and one Telegram summary fires pointing the admin at `/admin/clone-watch#approvals`. Fails closed if `RESEND_FROM_EMAIL` unset. Singleton (`mode:'skip'`); finish-timeout 10m. |
| `shopfront-clone-lifecycle-recheck`    | cron `0 */6 * * *` + manual-trigger event                                    | Re-scans the `monitoring`/`declined` tail (gated `FF_SHOPFRONT_CLONE_RECHECK` + `FF_SHOPFRONT_CLONE_URLSCAN`, brake `shopfront_clone_recheck`; ON in prod since 2026-07-10). **F3 (v222): over-fetches 200 staleness-ordered candidates, ranks by the deterministic weaponisation-risk score (`lib/clone-watch/weaponisation-risk.ts` — the ONE formula; the RPC returns inputs only), rescans the top 50.** Re-emits `scan-requested.v1 (reason='rescan')`; a flip to `likely_phishing` → `weaponised.v1`. Score distribution logged to cost_telemetry per run (weight-tuning feedstock).                                                                                                                                                                                                                                       |
| `shopfront-clone-netcraft-reconcile`   | cron `0 10 * * *` + manual-trigger event                                     | Per-URL lifecycle reconciler (v217, gated `FF_CLONE_LIFECYCLE_RECONCILE`, ON in prod). Reads `GET /submission/{uuid}/urls` (keyless), advances `lifecycle_state` by each URL's own verdict (`malicious`→taken_down + witnessed `takedown_at`; `no threats`/`unavailable`→declined). 12 uuids/run, 8m budget, soft-fail fetch. The single Netcraft verdict source.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `shopfront-clone-netcraft-issue`       | cron `0 11 * * *` + manual-trigger event                                     | False-negative `report_issue` reporter (v215/v216, gated `FF_CLONE_NETCRAFT_ISSUE`; LIVE since 2026-07-11, `NETCRAFT_ISSUE_DRY_RUN=false`, cap `NETCRAFT_ISSUE_DAILY_CAP=10`, brake `clone_netcraft_issue` + autobrake). **F4 evidence gate (v221)**: worklist = `likely_phishing` OR `weaponised` only. **F3 liveness pre-check**: a $0 GET per candidate; all-dead uuids get a non-terminal `recheck_after` (+72h) instead of spending the one-per-submission issue slot; partial-live files the live subset and stamps dead ones `dead_at_probe`.                                                                                                                                                                                                                                                                             |
| `shopfront-clone-enforcement-plan`     | event `shopfront/clone.weaponised.v1`                                        | Wave 1 — opens one takedown case per applicable channel (`merge_takedown_case`, dedup per alert+channel) when a lookalike weaponises. Gated `FF_CLONE_ENFORCEMENT` + brake `clone_enforcement`. Cases only — outbound sends are `shopfront-clone-enforcement-execute`'s job.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `shopfront-clone-notify-weaponised`    | event `shopfront/clone.weaponised.v1`                                        | F1 — BRAND-facing weaponisation early-warning (v220, gated `FF_CLONE_WEAPONISED_ALERT`, default OFF). When a monitored lookalike flips to `likely_phishing`, reloads the alert, resolves the contact via `brand_contact_directory`, STOP-checks, enqueues ONE urgent `kind='weaponised'` queue row (`enqueue_weaponised_clone_alert_notification`), renders `WeaponisedCloneAlert` + stages a single-alert `pending` batch (ALWAYS four-eyes — bypasses the daily prepare cron + its 24h cooldown), 🚨 Telegram-pages the admin. Send happens via the unchanged `/api/admin/clone-watch/batches/[batchId]/send` route. No-contact/manual-channel outcomes still 🚨-page. Dedup: Inngest `idempotency: alertId` + `submitted_to.weaponised_notification` stamp + v220 partial unique index.                                       |
| `shopfront-clone-poll-netcraft`        | manual-trigger event only (cron removed)                                     | Polls Netcraft for takedown status, updates `submitted_to.netcraft.{state,takedown_at}`. Powers median time-to-takedown KPI. **The hourly cron was removed** (`clone-watch-poll-netcraft.ts` — Netcraft submission is dark in prod: `FF_SHOPFRONT_CLONE_SUBMIT_NETCRAFT` + `NETCRAFT_REPORT_API_KEY` unset, so polling only burned executions to early-return). Re-add `{ cron: "0 * * * *" }` when submission is enabled.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `shopfront-clone-weekly-digest`        | cron `0 10 * * 0` (Sun)                                                      | Layer 5 — aggregates the week, Telegram-pages admin with KPI summary + LinkedIn-post draft (PR #483 — names brands we reported to as public proof).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `shopfront-clone-urlscan`              | event `shopfront/clone.scan-requested.v1`                                    | Phase A.3 — submits candidate URL to urlscan.io, waits 60s + 30s retry, retrieves, auto-classifies (parked / unresolved / likely_phishing / neutral), persists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `shopfront-clone-urlscan-rescan`       | cron `0 11 * * *` + manual-trigger event                                     | Phase A.3 — fans out scan-requested events for stale rows (>24h since last scan, within 60-day window). Catches the parked → activated transition.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `clone-watch-auto-triage`              | cron `0 13 * * *`                                                            | Gated `FF_CLONE_WATCH_AUTO_TRIAGE` (default OFF). Two jobs, both reuse existing scores (no new paid calls): **(1) auto-park** the weak not-a-clone tail — `pending` NRD rows the Haiku pre-classifier marked `is_clone=false` AND whose primary signal is weak (not confusable/levenshtein) → bulk-set `needs_investigation` (reversible; clears them from the human queue). Keeps strong-signal not-clone rows for a human. **(2) auto-confirm** the high-confidence live tail (Haiku ≥0.9 + confusable/levenshtein + urlscan `likely_phishing` + liveness) → `tp_confirmed`. Emails ONLY `CLONE_WATCH_SHADOW_RECIPIENT` (validation) and deliberately does NOT emit `clone.triaged.v1` — so it never triggers a brand email or Netcraft submit.                                                                                |
| `reddit-brands-discover`               | cron `0 7 * * 1` (Mon) + `reddit-brands/discover.manual-trigger.v1`          | Weekly watchlist-candidate discovery. Aggregates `reddit_post_intel.brands_impersonated[]` over 30d, resolves via the v174 alias layer, drops already-watched brands, upserts the remainder to `reddit_watchlist_candidates` + a net-new Telegram digest. **Since v196 (brand-convergence Phase 1), when `FF_SCAM_BRANDS_SOURCE` is ON it also aggregates a second source — `scam_reports.impersonated_brand` — into the same queue (`source='scam_reports'`).** No paid API.                                                                                                                                                                                                                                                                                                                                                    |
| `brand-register-refresh`               | cron `30 3 * * *` (daily) + `brand-register/refresh.manual-trigger.v1`       | Brand-convergence Phase 3 (v198). Gated `FF_BRAND_REGISTER` (default OFF → no-op). Rebuilds `brand_register` ("brand 360"): one row per canonical brand with 30-day scam/reddit/clone counts + watchlist + curation status, keyed on the v174 alias layer. Atomic `replace_brand_register` (upsert + delete-stale, empty-batch-guarded). `concurrency 1`, `singleton: skip`, finish-timeout 5m, 6 steps/run (≈180 step-runs/month when ON — see ADR-0019 budget). No paid API.                                                                                                                                                                                                                                                                                                                                                   |

---

## Python scrapers (23 in `pipeline/scrapers/`)

Run on GitHub Actions, gated by `ENABLE_SCRAPER` (regular) / `ENABLE_VULN_SCRAPER` (vulnerability) / `ENABLE_CHARITY_CHECK_INGEST` (ACNC + PFRA).

**Exit-code semantics** (#564): each scraper's `__main__` exits non-zero **only** on a hard `"error"` status — `skipped` / `partial` / `success` all exit 0 — so the GitHub Actions notify-failure step pages only on real failures, not on a quiet no-op run. Per #567, `scrape-feeds.yml` also captures per-feed failures into a file and runs a final gate step that fails the job at the end, so one feed's error no longer aborts the rest of the sequential run.

### Narrative scrapers (write to `feed_items`)

| Scraper                   | Source                | Schedule                                          | Notes                                                                                                                                                                                                                                                    |
| ------------------------- | --------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acnc_register.py`        | ACNC CKAN dataset     | Daily 16:00 UTC                                   | Gated `ENABLE_CHARITY_CHECK_INGEST`. Chunked TOUCH_LAST_SEEN_SQL pattern (post-PR #187).                                                                                                                                                                 |
| `scamwatch_alerts.py`     | scamwatch.gov.au HTML | 3h tier (`*/3`)                                   | Narrative extraction                                                                                                                                                                                                                                     |
| `acsc_alerts.py`          | cyber.gov.au RSS      | 3h tier                                           | UA-fallback for Cloudflare WAF (Mozilla UA on retry)                                                                                                                                                                                                     |
| `asic_investor_alerts.py` | asic.gov.au JSON      | Daily 16:00 UTC                                   | Investor alerts snapshot                                                                                                                                                                                                                                 |
| `austrac.py`              | austrac.gov.au RSS    | **Manual only** (disabled on schedule 2026-06-29) | Money-mule + payments-fraud typology reports. PR-B3 v131. Akamai blocks CI datacenter IPs regardless of UA → tripped its circuit breaker; feed is healthy from a browser UA/normal IP. Re-probe with `gh workflow run scrape-feeds.yml -f feed=austrac`. |
| `probe_acsc.py`           | cyber.gov.au probe    | Manual                                            | Diagnostic for WAF behaviour                                                                                                                                                                                                                             |
| `reddit_scams.py`         | Reddit `r/Scams`      | Daily 06:00 UTC                                   | Source for Reddit Intel pipeline                                                                                                                                                                                                                         |

### IOC scrapers (write to `vulnerability_iocs` and entity tables)

| Scraper                | Source                   | Schedule               |
| ---------------------- | ------------------------ | ---------------------- | ----------------------------- |
| `urlhaus.py`           | abuse.ch URLhaus         | 6h / 12h / daily tiers |
| `openphish.py`         | OpenPhish                | 6h / 12h / daily tiers |
| `phishtank.py`         | PhishTank                | 6h / 12h / daily tiers |
| `phishstats.py`        | PhishStats               | 12h / daily tiers      |
| `phishing_database.py` | Phishing Database mirror | 12h / daily tiers      |
| `phishing_army.py`     | Phishing Army            | 12h / daily tiers      |
| `feodo.py`             | Feodo Tracker            | 12h / daily tiers      |
| `spamhaus.py`          | Spamhaus DROP/EDROP      | 12h / daily tiers      |
| `ipsum.py`             | IPSUM proxy list         | Daily 16:00 UTC        |
| `abuseipdb.py`         | AbuseIPDB                | Daily 16:00 UTC        |
| `crtsh.py`             | crt.sh CT logs           | Daily 16:00 UTC        | Brand-impersonation detection |
| `cert_au.py`           | CERT-AU advisories       | Weekly 04:00 UTC       |
| `cryptoscamdb.py`      | CryptoScamDB             | (paused / TBD)         |
| `threatfox.py`         | abuse.ch ThreatFox       | (paused / TBD)         |

### B2B / vertical scrapers

| Scraper           | Source               | Schedule                                              |
| ----------------- | -------------------- | ----------------------------------------------------- |
| `pfra_members.py` | PFRA member registry | Daily 16:00 UTC. Gated `ENABLE_CHARITY_CHECK_INGEST`. |

### Vulnerability feeds (weekly, separate workflow)

Triggered by `.github/workflows/scrape-vulnerabilities.yml`, Sundays 04:00 UTC, gated `ENABLE_VULN_SCRAPER`:

- CISA KEV
- NVD (7-day delta)
- GitHub Advisories (gated by `GHSA_PAT`)
- OSV.dev (npm + pypi)

---

## GitHub Actions workflows (8)

In `.github/workflows/`:

| Workflow                     | Trigger                                                        | Gate                        | Purpose                                                                                                  |
| ---------------------------- | -------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `scrape-feeds.yml`           | 4 cron tiers: `0 */3`, `0 */6`, `0 */12`, `0 16 * * *`         | `ENABLE_SCRAPER`            | Run narrative + IOC scrapers in tiers (matches upstream update cadence)                                  |
| `scrape-vulnerabilities.yml` | `0 4 * * 0` (Sun 04:00 UTC)                                    | `ENABLE_VULN_SCRAPER`       | Vulnerability feeds (CISA KEV, NVD, OSV, GitHub Advisories, CERT-AU)                                     |
| `dr-pg-dump.yml`             | schedule (TBD)                                                 | —                           | Disaster-recovery dump                                                                                   |
| `ci.yml`                     | `push` to main + PR                                            | —                           | Lint, typecheck, test, build (Turbo cached)                                                              |
| `promptfoo.yml`              | PR path-filter (`evals/`, `claude.ts`, `analysis.ts`) + manual | —                           | Regression eval (Haiku) on prompt changes                                                                |
| `claude-code-review.yml`     | schedule (TBD)                                                 | —                           | Automated PR review                                                                                      |
| `deep-investigation.yml`     | schedule (TBD)                                                 | `ENABLE_DEEP_INVESTIGATION` | Weekly passive reconnaissance on CRITICAL / HIGH risk entities (nmap, dnsrecon, whatweb, sslscan, nikto) |
| `deploy.yml`                 | manual                                                         | —                           | Placeholder                                                                                              |

### Deep investigation pipeline

| Tool                             | Entity types | Output                                           |
| -------------------------------- | ------------ | ------------------------------------------------ |
| `nmap -sV`                       | IP           | Open ports, service versions, OS guess           |
| `nmap --script ssl-enum-ciphers` | IP           | Weak ciphers, deprecated TLS                     |
| `whois`                          | IP           | ASN, network name, bulletproof hosting detection |
| `dnsrecon`                       | Domain       | Subdomains, zone transfer, wildcard DNS          |
| `whatweb`                        | Domain       | Technology fingerprinting (CMS, frameworks)      |
| `sslscan`                        | Domain       | Protocol support, self-signed certs              |
| `nikto`                          | URL          | Exposed admin panels, directory listings         |
| `curl -sI`                       | URL          | Security headers, redirect chain                 |

Results stored in `scam_entities.investigation_data` JSONB. Max 50 entities/run, 1s delay between targets, private-IP filtering, no active exploitation.

---

## Supabase Database Webhooks (pg_net)

| Table               | Event  | Target             | Purpose                                                              |
| ------------------- | ------ | ------------------ | -------------------------------------------------------------------- |
| `bot_message_queue` | INSERT | `/api/bot-webhook` | Async dispatch to Telegram / WhatsApp / Slack / Messenger via Vonage |

Backed by `/api/cron/bot-queue-sweep` (every 6h) which picks up rows pending >2 min. Webhook is configured in the Supabase dashboard (not in migration SQL).

---

## Cloudflare Workers

External compute that doesn't fit Vercel cron or Inngest. Source lives under `apps/`.

| Worker                          | Source                          | Trigger                  | Purpose                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `askarthur-intel-inbound-email` | `apps/cloudflare-email-worker/` | Cloudflare Email Routing | Receives inbound newsletter mail at `<tag>+ingest@askarthur-inbound.com`, parses MIME via postal-mime, attributes source by tag, resolves GovDelivery/Mailchimp redirects, POSTs to the `intel-inbound-email` Supabase Edge Function which inserts a `feed_items` row. Gated via Edge Function env `ENABLE_INTEL_INBOUND_EMAIL`. See [docs/ops/inbound-email-config.md](../ops/inbound-email-config.md). |

Redeploy procedure when the Worker source changes: from `apps/cloudflare-email-worker/` run `pnpm typecheck && pnpm wrangler deploy`. The CLI needs a Cloudflare API token with `workers (write)` + `workers_scripts (write)` zone scope. Merging the source change to `main` does NOT auto-redeploy the Worker — Cloudflare deploy is a separate step. The `add-inbound-email-source` skill covers the end-to-end including this step.

---

## Cost brakes and safety nets

| Safety net                | Cron           | Checks                                    | Action                                                                                                                                                                                                                    |
| ------------------------- | -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cost-daily-check`        | `0 */6 * * *`  | `today_cost_total` view per feature       | Set `feature_brakes` row when caps exceeded: `REDDIT_INTEL_CAP_USD` ($10), `PHONE_FOOTPRINT_CAP_USD` ($5), `VULN_AU_ENRICHMENT_CAP_USD` ($5), `CHARITY_CHECK_CAP_USD` ($5), `DAILY_COST_THRESHOLD_USD` ($2 → admin alert) |
| `cost-weekly-digest`      | `0 22 * * 0`   | `cost_telemetry` WoW delta                | Admin Telegram: last week vs previous + top 5 features                                                                                                                                                                    |
| `pg-stuck-query-watchdog` | `*/5 * * * *`  | `list_long_running_queries` RPC (≥10 min) | Telegram alert ≥10 min, terminate ≥60 min (gated `PG_WATCHDOG_AUTO_TERMINATE`)                                                                                                                                            |
| `scraper-brake-alert`     | `*/15 * * * *` | `feature_brakes` lookup (20-min window)   | Telegram alert on brake activation                                                                                                                                                                                        |
| `feedback-digest`         | `0 9 * * *`    | `verdict_feedback` summary                | Admin Telegram: correctness matrix                                                                                                                                                                                        |
| `health-digest`           | `0 22 * * *`   | `cost_telemetry` errors                   | Admin Telegram: errors by feature                                                                                                                                                                                         |

**Use bare numbers** for env vars (`5`, `10`) — non-numeric values silently disable the brake because `parseFloat("$10")` is `NaN`.

---

## What runs when (timetable)

```
*/5    pg-stuck-query-watchdog              (every 5 min)
*/15   scraper-brake-alert                   (every 15 min)
*/30   feedback-triage-refresh               (every 30 min, Inngest; change-guarded — most ticks skip the REFRESH)
hourly feed-items-embed                      (Inngest)
hourly regulator-alert-push                  (Inngest)
hourly enrich-vulnerabilities-cron           (Inngest)
hourly phone-footprint-refresh-claimer       (Inngest, TZ=Australia/Sydney)
every 3h scam-alert-push                     (Inngest)
every 3h report-onward-auto-report           (Inngest, at :25)
every 4h pipeline-entity-enrichment, urlscan-enrichment (Inngest)
every 6h pipeline-enrichment-fanout, risk-scorer (Inngest)
every 6h bot-queue-sweep, cost-daily-check    (Vercel)
every 6h competitor-intel-extract            (Inngest, FF_COMPETITOR_INTEL_EXTRACT)

02:00 ensure-partitions                       (Vercel)
02:30 feed-retention                          (Inngest)
02:00 billing-ingest-nightly                  (Inngest)
03:00 vuln-retention                          (Vercel)
03:00 pipeline-staleness-check[/ips/wallets]  (Inngest)
03:15 phone-footprint-retention               (Inngest)
03:30 scam-reports-retention                  (Vercel)
03:45 reddit-processed-posts-retention        (Inngest)
04:00 bot-queue-cleanup                       (Vercel)
04:00 acnc-charity-backfill-embed             (Inngest)
04:00 pipeline-cluster-builder                (Inngest)
04:00 cost-telemetry-retention                (Inngest)
04:30 reddit-intel-retention                  (Vercel)
04:30 telco-events-retention                  (Inngest)
05:00 archive-shadows-retention               (Inngest)
08:00 reddit-intel-trigger                    (Vercel)
09:00 feedback-digest                         (Vercel)
12:00 weekly-blog                             (Vercel, Mondays)
13:00 clone-watch-auto-triage                 (Inngest, FF_CLONE_WATCH_AUTO_TRIAGE)
14:00 weekly-email                            (Vercel, Mondays)
22:00 health-digest                           (Vercel)
22:00 cost-weekly-digest                      (Vercel, Sundays)
23:00 nurture                                 (Vercel)
```

Anything between 02:00 and 05:00 UTC is in the housekeeping window. Anything outside that window must complete in <5 min on a healthy DB or it will page the `pg-stuck-query-watchdog`.

---

## News Intel scrapers — operational note

AU regulator narrative scrapers (Scamwatch HTML, ACSC RSS, ASIC JSON) shipped 2026-05-06 (PR #137 + fixes #138/#139, migration v97). Scrapers in `pipeline/scrapers/{scamwatch,acsc,asic_investor}_alerts.py` write to `feed_items` with `source IN ('scamwatch_alert','acsc','asic_investor')`. Voyage embedding via `feed-items-embed` Inngest cron (`0 * * * *`, hourly). Weekly digest folds in via `regulatorAlerts` section + Clone Watch section (`getWeeklyCloneWatch` → `cloneWatch` prop) in `WeeklyIntelDigest.tsx`.

**Retention** (migration v98): narrative `feed_items` >365d → `feed_items_archive`; `feed_ingestion_log` pruned 90d; `feed_http_cache` pruned 30d. All housekeeping runs nightly at 02:30 UTC via `feed-retention` Inngest function.

**Known issue**: `cyber.gov.au` RSS occasionally times out from GitHub Actions IPs (suspected UA filtering by Cloudflare WAF) — `common/http_cache.py` falls back to a Mozilla UA on retry; persistent failures log cleanly to `feed_ingestion_log` so the 3h cron self-heals on next reachable window.
