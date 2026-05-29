// Inngest function registry — all pipeline functions exported as a single array
// for the serve() handler.

import { stalenessCheck } from "./staleness";
import { stalenessCheckIPs } from "./staleness-ips";
import { stalenessCheckWallets } from "./staleness-wallets";
import { enrichmentFanOut } from "./enrichment";
import { ctMonitor } from "./ct-monitor";
import { entityEnrichmentFanOut } from "./entity-enrichment";
import { clusterBuilder } from "./cluster-builder";
import { riskScorer } from "./risk-scorer";
import { urlscanEnrichment } from "./urlscan-enrichment";
import { scamAlertCron } from "./scam-alerts";
import { syncVerifiedScamsToFeed, syncUserReportsToFeed } from "./feed-sync";
// meta-brp-report intentionally NOT registered (PR-C): it's a pure stub —
// FF_META_BRP_REPORTER is unset so it fired every 6h only to skip, and the
// Graph API integration is still commented out. The file is kept so it can be
// re-registered when the real Meta BRP integration ships.
import { enrichVulnerability, enrichVulnerabilitiesCron } from "./enrich-vulnerability";
import { matchB2bExposure } from "./match-b2b-exposure";

// Phase 2: analyze.completed.v1 fan-out — durable replacements for the
// ad-hoc waitUntil writes that used to hang off /api/analyze.
import { handleAnalyzeCompletedReport } from "./analyze-report";
import { handleAnalyzeCompletedBrand } from "./analyze-brand";
import { handleAnalyzeCompletedCost } from "./analyze-cost";
import { onAnalyzeFailed } from "./analyze-failure";

// Reddit Intel Wave 1: daily batched classifier triggered by cron poller.
import { redditIntelDaily } from "./reddit-intel-daily";

// Reddit Intel Wave 2: embed newly classified posts (Voyage 3 default)
// then greedy-cluster them into themes + name pending themes via Sonnet.
import { redditIntelEmbed } from "./reddit-intel-embed";
import { redditIntelCluster } from "./reddit-intel-cluster";

// ACNC charity register: backfill + delta-embed sibling table acnc_charity_embeddings
// (v121/v122). Powers the semantic typosquat signal in packages/charity-check.
import { acncCharityBackfillEmbed } from "./acnc-charity-backfill-embed";

// scam_reports + verified_scams embeddings (Phase C):
//   * scamReportEmbed runs per submission via scam-report.stored.v1
//   * scamReportsBackfillEmbed is manual-trigger for the historical tail
import { scamReportEmbed } from "./scam-report-embed";
import { scamReportsBackfillEmbed } from "./scam-reports-backfill-embed";

// Feedback learning loop (W1.1): refresh the feedback_triage_queue MV
// every 5 min so /admin/feedback stays current.
import { feedbackTriageRefresh } from "./feedback-triage-refresh";

// News Intel: embed regulator narratives (Scamwatch/ACSC/ASIC) into
// feed_items.embedding so hybrid retrieval can fold them in alongside
// scam_reports + reddit_post_intel. Cron-driven 30-min poll.
import { feedItemsEmbed } from "./feed-items-embed";

// News Intel: nightly retention housekeeping — archive narratives >365d
// to feed_items_archive, prune feed_ingestion_log >90d, prune
// feed_http_cache >30d. 02:30 UTC.
import { feedRetention } from "./feed-retention";

// News Intel: push notifications for newly-ingested regulator narratives.
// Cron */30 min — single ASIC/Scamwatch alert is more authoritative than
// 100 user reports, so it gets a dedicated push (not bundled like scam-alerts).
import { regulatorAlertPush } from "./regulator-alert-push";

// Phone Footprint: nightly anonymisation + monitor consent sweep. Wires
// up RPCs that v75 created but no scheduler invoked. 03:15 UTC.
import { phoneFootprintRetention } from "./phone-footprint-retention";

// Reddit Intel: prune reddit_processed_posts dedup tracker (30-day
// horizon matches scraper re-encounter window). 03:45 UTC.
import { redditProcessedPostsRetention } from "./reddit-processed-posts-retention";

// Cost Telemetry: nightly rollup + 90d prune. Rollup table preserves
// long-range aggregates; raw rows >90d deleted. 04:00 UTC.
import { costTelemetryRetention } from "./cost-telemetry-retention";

// Billing ingest: nightly per-provider infra-spend rollup → infra_cost_daily
// (v134). Pulls Vercel /v1/billing/charges + Anthropic sums from
// cost_telemetry + Supabase Pro-base prorate. 02:00 UTC.
import { billingIngestNightly } from "./billing-ingest-nightly";

// Telco events: nightly prune across 7 append-only tables. 730d for
// sim/device-swap-events (forensic); 365d for the rest. 04:30 UTC.
import { telcoEventsRetention } from "./telco-events-retention";

// Archive shadows: nightly archival mover for 6 medium-volume tables
// (flagged_ads, deepfake_detections, media_analyses, scan_results,
// verdict_feedback, brand_impersonation_alerts). 05:00 UTC.
import { archiveShadowsRetention } from "./archive-shadows-retention";

// Shop Signal: Deep Shop Check enrichment — consumes shop.check.requested.v1
// (user-initiated), runs ABN + WHOIS + APIVoid, writes back to shop_checks.
import { shopSignalEnrich } from "./shop-signal-enrich";

// Shopfront Clone-Watch: Layer 0 daily NRD sweep against the static
// AU brand watchlist (S0E.2). Writes hits into shopfront_clone_alerts
// with target_shop_id IS NULL, source = 'nrd'. Gated by
// FF_SHOPFRONT_CLONE_WATCH (default OFF).
import { shopfrontNrdDailyIngest } from "./shopfront-nrd-daily-ingest";

export const inngestFunctions = [
  stalenessCheck,
  stalenessCheckIPs,
  stalenessCheckWallets,
  enrichmentFanOut,
  ctMonitor,
  entityEnrichmentFanOut,
  clusterBuilder,
  riskScorer,
  urlscanEnrichment,
  scamAlertCron,
  syncVerifiedScamsToFeed,
  syncUserReportsToFeed,
  enrichVulnerability,
  enrichVulnerabilitiesCron,
  matchB2bExposure,
  // Phase 2 analyze fan-out
  handleAnalyzeCompletedReport,
  handleAnalyzeCompletedBrand,
  handleAnalyzeCompletedCost,
  onAnalyzeFailed,
  // Reddit Intel Wave 1
  redditIntelDaily,
  // Reddit Intel Wave 2
  redditIntelEmbed,
  redditIntelCluster,
  // Charity Check semantic
  acncCharityBackfillEmbed,
  // scam_reports + verified_scams embeddings
  scamReportEmbed,
  scamReportsBackfillEmbed,
  // Feedback learning loop
  feedbackTriageRefresh,
  // News Intel: regulator-narrative embedding
  feedItemsEmbed,
  // News Intel: nightly retention housekeeping
  feedRetention,
  // News Intel: regulator-alert push fan-out
  regulatorAlertPush,
  // Phone Footprint: nightly anonymisation + monitor consent sweep
  phoneFootprintRetention,
  // Reddit Intel: nightly dedup-tracker prune (30d)
  redditProcessedPostsRetention,
  // Cost Telemetry: nightly rollup + 90d prune
  costTelemetryRetention,
  // Billing ingest: nightly per-provider infra-spend rollup (v134)
  billingIngestNightly,
  // Telco events: nightly prune (730d sim/device-swap; 365d others)
  telcoEventsRetention,
  // Archive shadows: nightly archival mover (6 medium-volume tables)
  archiveShadowsRetention,
  // Shop Signal: Deep Shop Check enrichment (user-initiated)
  shopSignalEnrich,
  // Shopfront Clone-Watch: Layer 0 daily NRD sweep (S0E.2)
  shopfrontNrdDailyIngest,
];
