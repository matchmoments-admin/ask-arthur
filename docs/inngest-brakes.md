# Inngest brake-coverage matrix

Inventory of every Inngest function and its safety brakes. Maintained as a checklist: any blank cell where a brake should exist is a P1 ticket.

**Brake glossary**

- **Conc.** — `concurrency: { limit: N }`. Caps in-flight runs.
- **Rate** — `rateLimit: { limit, period }`. Caps invocations per period (defends against manual-trigger storms even on cron functions).
- **Throt.** — `throttle: { limit, period }`. Caps work _inside_ runs (e.g. external-API submission count).
- **Idem.** — `idempotency` key. Inngest dedups events with the same key.
- **Kill** — feature flag or env var that early-returns the function. Durable kill-switch.
- **Cost** — function writes to `cost_telemetry` for paid-API calls.
- **Brake** — function checks `feature_brakes.<feature>.paused_until` and early-returns if set.

| Function id                               | Trigger                                              | Conc. | Rate                     | Throt. | Idem.                    | Kill (flag)         | Cost        | Brake       |
| ----------------------------------------- | ---------------------------------------------------- | ----- | ------------------------ | ------ | ------------------------ | ------------------- | ----------- | ----------- |
| **Reddit Intel**                          |                                                      |       |                          |        |                          |                     |             |             |
| `reddit-intel-daily`                      | event `reddit.intel.batch_ready.v1`                  | —     | —                        | —      | —                        | `redditIntelIngest` | ✓           | ✓           |
| `reddit-intel-embed`                      | event `reddit.intel.summarised.v1`                   | —     | —                        | —      | —                        | `redditIntelIngest` | ✓           | ✓           |
| `reddit-intel-cluster`                    | event `reddit.intel.embedded.v1`                     | —     | —                        | —      | —                        | `redditIntelIngest` | ✓           | ✓           |
| **Analyze fan-out**                       |                                                      |       |                          |        |                          |                     |             |             |
| `analyze-completed-report`                | event `analyze.completed.v1`                         | —     | —                        | —      | `requestId`              | —                   | —           | —           |
| `analyze-completed-brand`                 | event `analyze.completed.v1`                         | —     | —                        | —      | `requestId`              | —                   | —           | —           |
| `analyze-completed-cost`                  | event `analyze.completed.v1`                         | —     | —                        | —      | `requestId`              | —                   | ✓           | —           |
| `analyze-failure-subscriber`              | event `inngest/function.failed`                      | —     | —                        | —      | —                        | —                   | —           | —           |
| **Phone Footprint**                       |                                                      |       |                          |        |                          |                     |             |             |
| `phone-footprint-refresh-claimer`         | cron hourly (TZ Sydney)                              | 1     | —                        | —      | —                        | —                   | —           | —           |
| `phone-footprint-refresh-monitor`         | event `phone-footprint/refresh.monitor.v1`           | 5     | —                        | —      | `queueId`                | —                   | — _Track C_ | — _Track C_ |
| `phone-footprint-pdf-render`              | event `phone-footprint/pdf.render.v1`                | 5     | —                        | —      | `requestId\|footprintId` | —                   | ✓           | —           |
| `phone-footprint-vonage-backfill-pager`   | event `phone-footprint/vonage.backfill.requested.v1` | 1     | —                        | —      | `requestId`              | —                   | —           | —           |
| `phone-footprint-vonage-backfill-monitor` | event `phone-footprint/vonage.backfill.monitor.v1`   | 5     | —                        | —      | `requestId+monitorId`    | —                   | — _Track C_ | — _Track C_ |
| **Pipeline / threat feed**                |                                                      |       |                          |        |                          |                     |             |             |
| `pipeline-staleness-check`                | cron daily 03:00 UTC                                 | —     | —                        | —      | —                        | `dataPipeline`      | —           | —           |
| `pipeline-staleness-check-ips`            | cron daily 03:00 UTC                                 | —     | —                        | —      | —                        | `dataPipeline`      | —           | —           |
| `pipeline-staleness-check-wallets`        | cron daily 03:00 UTC                                 | —     | —                        | —      | —                        | `dataPipeline`      | —           | —           |
| `pipeline-enrichment-fanout`              | cron every 6h                                        | 1     | 1/30m                    | —      | —                        | `dataPipeline`      | — _Track C_ | — _Track C_ |
| `pipeline-ct-monitor`                     | cron every 12h                                       | —     | —                        | —      | —                        | —                   | —           | —           |
| `pipeline-cluster-builder`                | cron daily 04:00 UTC                                 | 1     | —                        | —      | —                        | `dataPipeline`      | —           | —           |
| `pipeline-entity-enrichment`              | cron every 4h                                        | 1     | 1/10m                    | —      | —                        | `entityEnrichment`  | — _Track C_ | — _Track C_ |
| `pipeline-risk-scorer`                    | cron every 6h                                        | 1     | —                        | —      | —                        | `riskScoring`       | —           | —           |
| `pipeline-urlscan-enrichment`             | cron every 4h (offset 30m)                           | 1     | 1/10m                    | 50/h   | —                        | `urlScanIO`         | — _Track C_ | — _Track C_ |
| **Vuln intel**                            |                                                      |       |                          |        |                          |                     |             |             |
| `enrich-vulnerability-au-context`         | event `vulnerability.created`                        | 5     | —                        | 500/h  | —                        | `vulnAuEnrichment`  | ✓           | ✓           |
| `enrich-vulnerabilities-cron`             | cron hourly                                          | 1     | —                        | —      | —                        | `vulnAuEnrichment`  | ✓           | ✓           |
| **Feed sync**                             |                                                      |       |                          |        |                          |                     |             |             |
| `feed-sync-verified-scams`                | cron weekly Sun 07:00 UTC                            | —     | —                        | —      | —                        | —                   | —           | —           |
| `feed-sync-user-reports`                  | cron weekly Sun 07:00 UTC                            | —     | —                        | —      | —                        | —                   | —           | —           |
| **Other**                                 |                                                      |       |                          |        |                          |                     |             |             |
| `meta-brp-report`                         | cron every 6h                                        | 1     | 200/d (`Meta-BRP-Daily`) | —      | —                        | `metaBrpReporter`   | — _Track C_ | — _Track C_ |
| `scam-alert-push`                         | cron every 3h                                        | —     | —                        | —      | —                        | `pushAlerts`        | —           | —           |

## Outstanding gaps (P1 tickets)

- **Track C (cost telemetry)** — extend `logCost()` coverage to: `pipeline-enrichment-fanout` (WHOIS/SSL count), `pipeline-entity-enrichment` (Twilio Lookup, AbuseIPDB, IPQS, HIBP), `pipeline-urlscan-enrichment` (urlscan submission), `phone-footprint-refresh-monitor` (Vonage NI v2, Vonage CAMARA, Twilio Lookup, IPQS), `phone-footprint-vonage-backfill-monitor` (Vonage CAMARA). Also add per-feature `feature_brakes` rows: `phone_footprint`, `urlscan_io`, `entity_enrichment`, `meta_brp`. The `cost-daily-check` cron at `apps/web/app/api/cron/cost-daily-check/route.ts` already implements the brake-set pattern for `reddit_intel` and `vuln_au_enrichment` — extend that logic.
- **`pipeline-ct-monitor`** — no feature flag and no concurrency cap. crt.sh is free but the function is a candidate for a dedicated `ctMonitor` flag once the AU-priority brand watchlist work lands.
- **`feed-sync-*`** — no feature flag. Both functions are read-only and idempotent so the risk is low, but a flag would let us pause them during DB maintenance.
- **`scam-alert-push`** — needs per-user throttling (1 push/day per user unless critical). FCM rate limits and user retention both motivate this.
- **`analyze-failure-subscriber`** — needs deduplication (e.g. `rateLimit { limit: 1, period: "10m", key: "function_id+error_signature" }`) so retries + burst failures don't spam Telegram.

## When you add a new Inngest function

A new function should arrive with at least these brakes from day one:

1. **A feature flag** — even if default-on. Server-only `FF_<NAME>` or `NEXT_PUBLIC_FF_<NAME>` per the convention in `packages/utils/src/feature-flags.ts`. The flag is the durable kill-switch.
2. **`concurrency: { limit: N }`** — pick a sane N for the work the function does. For singleton crons, 1.
3. **`rateLimit`** if the function is cron-triggered or accepts user-triggered events — defends against manual-trigger storms. Cron-safe rule of thumb: pick a period < cron cadence (e.g. 5–30m for a 6h cron).
4. **`idempotency`** if the function is event-triggered and writes to DB — use a deterministic key from the event payload (`event.data.requestId` is the standard).
5. **`logCost()`** at every paid-API call site if the function touches a metered API. Pricing constants live in `apps/web/lib/cost-telemetry.ts`.
6. **`feature_brakes` check** at function entry if the function spends real money — pattern in `enrich-vulnerability.ts:isBrakeSet()` and `reddit-intel-daily.ts:isRedditIntelBraked()`. Add a row to the `cost-daily-check` cron for the new feature so it can be auto-paused at threshold.

Update this matrix when you add a function. A blank cell where a brake should exist is a P1.
