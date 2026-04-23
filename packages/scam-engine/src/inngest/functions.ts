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
];
