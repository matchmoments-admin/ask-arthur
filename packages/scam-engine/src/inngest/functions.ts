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
];
