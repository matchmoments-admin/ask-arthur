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
import { metaBrpReport } from "./meta-brp-report";
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

// ACNC charity register: backfill + delta-embed name_mission_embedding
// (powers the semantic typosquat signal in packages/charity-check).
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

// News Intel: ACSC ingest from Vercel egress (workaround for Akamai
// tarpitting Azure / GH Actions IPs). Default OFF — flip the flag after
// the first manual trigger confirms Vercel egress isn't also tarpitted.
import { acscIngestVercel } from "./acsc-ingest-vercel";

// Phone Footprint: nightly anonymisation + monitor consent sweep. Wires
// up RPCs that v75 created but no scheduler invoked. 03:15 UTC.
import { phoneFootprintRetention } from "./phone-footprint-retention";

// Reddit Intel: prune reddit_processed_posts dedup tracker (30-day
// horizon matches scraper re-encounter window). 03:45 UTC.
import { redditProcessedPostsRetention } from "./reddit-processed-posts-retention";

// Cost Telemetry: nightly rollup + 90d prune. Rollup table preserves
// long-range aggregates; raw rows >90d deleted. 04:00 UTC.
import { costTelemetryRetention } from "./cost-telemetry-retention";

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
  metaBrpReport,
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
  // News Intel: ACSC ingest from Vercel egress (Akamai-tarpit workaround)
  acscIngestVercel,
  // Phone Footprint: nightly anonymisation + monitor consent sweep
  phoneFootprintRetention,
  // Reddit Intel: nightly dedup-tracker prune (30d)
  redditProcessedPostsRetention,
  // Cost Telemetry: nightly rollup + 90d prune
  costTelemetryRetention,
];
