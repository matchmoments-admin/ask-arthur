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

## Inngest functions (35)

Defined in `packages/scam-engine/src/inngest/functions.ts`. All have idempotency keys based on `event.data.requestId` (24h dedup); cron functions use Inngest's native cron dedup.

### Analyze pipeline (fan-out on `analyze.completed.v1`)

| Function                     | Trigger                                     | Purpose                                                                  |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| `analyze-completed-report`   | `analyze.completed.v1`                      | Store `scam_reports` row + entity links via `create_scam_report` RPC     |
| `analyze-completed-brand`    | `analyze.completed.v1`                      | Create `brand_impersonation_alerts` row when `impersonatedBrand` present |
| `analyze-completed-cost`     | `analyze.completed.v1`                      | Log `cost_telemetry` row tagged by source + token counts                 |
| `analyze-failure-subscriber` | `inngest/function.failed` (prefix-filtered) | Log analyze pipeline failures                                            |

Gated by `FF_ANALYZE_INNGEST_WEB`. When false, the legacy `waitUntil` path runs inline in `/api/analyze`.

### Enrichment pipeline (recurring)

| Function                      | Cron           | Purpose                                                        |
| ----------------------------- | -------------- | -------------------------------------------------------------- |
| `pipeline-enrichment-fanout`  | `0 */6 * * *`  | URL WHOIS + SSL enrichment (20 domains/run, concurrency 1)     |
| `pipeline-entity-enrichment`  | `0 */4 * * *`  | Entity enrichment (wallet / IP / email)                        |
| `pipeline-ct-monitor`         | `0 */12 * * *` | Certificate Transparency monitoring for AU brand impersonation |
| `pipeline-urlscan-enrichment` | `30 */4 * * *` | URLScan async enrichment                                       |

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

| Function                      | Trigger                  | Purpose                                   |
| ----------------------------- | ------------------------ | ----------------------------------------- |
| `scam-alert-push`             | `0 */3 * * *` (every 3h) | HIGH-confidence threat push notifications |
| `scam-report-embed`           | `scam-report.stored.v1`  | Embed user reports for clustering         |
| `scam-reports-backfill-embed` | manual                   | Historical backfill                       |

### News Intel (regulator narratives)

| Function                   | Trigger                          | Purpose                                                                                       |
| -------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| `feed-items-embed`         | `*/30 * * * *` (every 30 min)    | Embed Scamwatch / ACSC / ASIC narratives via Voyage                                           |
| `feed-retention`           | `30 2 * * *` (nightly 02:30 UTC) | Archive `feed_items` >365d + prune `feed_ingestion_log` (90d) + prune `feed_http_cache` (30d) |
| `feed-sync-verified-scams` | `0 7 * * 0` (Sun 07:00 UTC)      | Sync `verified_scams` → `feed_items`                                                          |
| `feed-sync-user-reports`   | `0 7 * * 0` (Sun 07:00 UTC)      | Sync `scam_reports` → `feed_items`                                                            |
| `regulator-alert-push`     | `*/30 * * * *` (every 30 min)    | Push new ASIC / Scamwatch / ACSC alerts to opted-in users                                     |

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

| Function                  | Cron                        | Purpose                                                        |
| ------------------------- | --------------------------- | -------------------------------------------------------------- |
| `feedback-triage-refresh` | `*/5 * * * *` (every 5 min) | `REFRESH MATERIALIZED VIEW CONCURRENTLY feedback_triage_queue` |

### Metadata / external

| Function          | Cron                     | Purpose                                               |
| ----------------- | ------------------------ | ----------------------------------------------------- |
| `meta-brp-report` | `0 */6 * * *` (every 6h) | Meta Brand Rights Protection deepfake reporter (stub) |

### Onward reporting (event-driven, no cron)

| Function                        | Trigger                             | Purpose                                                |
| ------------------------------- | ----------------------------------- | ------------------------------------------------------ |
| `report-onward-scamwatch`       | `report.submitted.v1`               | Deep-link marker (no API; user lands on Scamwatch URL) |
| `report-onward-acma-email-spam` | `report.submitted.v1` (email spam)  | ACMA callback                                          |
| `report-onward-report-cyber`    | manual                              | ReportCyber callback                                   |
| `report-onward-idcare`          | manual                              | IDcare identity-theft support referral                 |
| `report-onward-ask-arthur-feed` | manual                              | Internal feed archive                                  |
| `onward-brand-abuse`            | `report.submitted.v1` (brand abuse) | Queue brand report submission                          |

---

## Python scrapers (23 in `pipeline/scrapers/`)

Run on GitHub Actions, gated by `ENABLE_SCRAPER` (regular) / `ENABLE_VULN_SCRAPER` (vulnerability) / `ENABLE_CHARITY_CHECK_INGEST` (ACNC + PFRA).

### Narrative scrapers (write to `feed_items`)

| Scraper                   | Source                | Schedule        | Notes                                                                                    |
| ------------------------- | --------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| `acnc_register.py`        | ACNC CKAN dataset     | Daily 16:00 UTC | Gated `ENABLE_CHARITY_CHECK_INGEST`. Chunked TOUCH_LAST_SEEN_SQL pattern (post-PR #187). |
| `scamwatch_alerts.py`     | scamwatch.gov.au HTML | 3h tier (`*/3`) | Narrative extraction                                                                     |
| `acsc_alerts.py`          | cyber.gov.au RSS      | 3h tier         | UA-fallback for Cloudflare WAF (Mozilla UA on retry)                                     |
| `asic_investor_alerts.py` | asic.gov.au JSON      | Daily 16:00 UTC | Investor alerts snapshot                                                                 |
| `austrac.py`              | austrac.gov.au RSS    | Daily 16:00 UTC | Money-mule + payments-fraud typology reports. PR-B3 v131. First Phase B Wave 2 scraper.  |
| `probe_acsc.py`           | cyber.gov.au probe    | Manual          | Diagnostic for WAF behaviour                                                             |
| `reddit_scams.py`         | Reddit `r/Scams`      | Daily 06:00 UTC | Source for Reddit Intel pipeline                                                         |

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
*/5    feedback-triage-refresh               (every 5 min, Inngest)
*/15   scraper-brake-alert                   (every 15 min)
*/30   feed-items-embed                      (every 30 min, Inngest)
*/30   regulator-alert-push                  (every 30 min, Inngest)
hourly enrich-vulnerabilities-cron           (Inngest)
hourly phone-footprint-refresh-claimer       (Inngest, TZ=Australia/Sydney)
every 3h scam-alert-push                     (Inngest)
every 4h pipeline-entity-enrichment, urlscan-enrichment (Inngest)
every 6h pipeline-enrichment-fanout, risk-scorer, meta-brp-report (Inngest)
every 6h bot-queue-sweep, cost-daily-check    (Vercel)
every 12h pipeline-ct-monitor                (Inngest)

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
14:00 weekly-email                            (Vercel, Mondays)
22:00 health-digest                           (Vercel)
22:00 cost-weekly-digest                      (Vercel, Sundays)
23:00 nurture                                 (Vercel)
```

Anything between 02:00 and 05:00 UTC is in the housekeeping window. Anything outside that window must complete in <5 min on a healthy DB or it will page the `pg-stuck-query-watchdog`.

---

## News Intel scrapers — operational note

AU regulator narrative scrapers (Scamwatch HTML, ACSC RSS, ASIC JSON) shipped 2026-05-06 (PR #137 + fixes #138/#139, migration v97). Scrapers in `pipeline/scrapers/{scamwatch,acsc,asic_investor}_alerts.py` write to `feed_items` with `source IN ('scamwatch_alert','acsc','asic_investor')`. Voyage embedding via `feed-items-embed` Inngest cron (`*/30 * * * *`). Weekly digest folds in via `regulatorAlerts` section in `WeeklyIntelDigest.tsx`.

**Retention** (migration v98): narrative `feed_items` >365d → `feed_items_archive`; `feed_ingestion_log` pruned 90d; `feed_http_cache` pruned 30d. All housekeeping runs nightly at 02:30 UTC via `feed-retention` Inngest function.

**Known issue**: `cyber.gov.au` RSS occasionally times out from GitHub Actions IPs (suspected UA filtering by Cloudflare WAF) — `common/http_cache.py` falls back to a Mozilla UA on retry; persistent failures log cleanly to `feed_ingestion_log` so the 3h cron self-heals on next reachable window.
