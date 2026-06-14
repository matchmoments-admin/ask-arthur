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

// News Intel: embed regulator narratives (Scamwatch/ACSC/ASIC) into
// feed_items.embedding so hybrid retrieval can fold them in alongside
// scam_reports + reddit_post_intel. Cron-driven 30-min poll.
import { feedItemsEmbed } from "./feed-items-embed";

// NOTE: 9 platform-housekeeping functions (feedback-triage-refresh,
// feed-retention, regulator-alert-push, phone-footprint-retention,
// reddit-processed-posts-retention, cost-telemetry-retention,
// billing-ingest-nightly, telco-events-retention, archive-shadows-retention)
// moved to apps/web/app/api/inngest/functions/ — they're platform jobs, not
// scam-analysis, and don't belong in this package's module identity (arch
// review #588 finding 2). They're registered directly in
// apps/web/app/api/inngest/route.ts. Function IDs are unchanged.

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
  // News Intel: regulator-narrative embedding
  feedItemsEmbed,
  // Shop Signal: Deep Shop Check enrichment (user-initiated)
  shopSignalEnrich,
  // Shopfront Clone-Watch: Layer 0 daily NRD sweep (S0E.2)
  shopfrontNrdDailyIngest,
];
