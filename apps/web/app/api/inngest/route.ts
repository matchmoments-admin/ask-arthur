import { serve } from "inngest/next";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { inngestFunctions } from "@askarthur/scam-engine/inngest/functions";
import { phoneFootprintPdfRender } from "./functions/phone-footprint-pdf";
import {
  phoneFootprintRefreshClaimer,
  phoneFootprintRefreshMonitor,
} from "./functions/phone-footprint-refresh";
import {
  phoneFootprintVonageBackfillPager,
  phoneFootprintVonageBackfillMonitor,
} from "./functions/phone-footprint-vonage-backfill";
import { onwardBrandAbuse } from "./functions/onward-brand-abuse";
import { onwardAcmaEmailSpam } from "./functions/onward-acma";
import { onwardOpenphish } from "./functions/onward-openphish";
import { onwardApwg } from "./functions/onward-apwg";
import { onwardAutoReport } from "./functions/onward-auto-report";
import {
  onwardScamwatch,
  onwardReportCyber,
  onwardIdcare,
  onwardAskArthurFeed,
} from "./functions/onward-skipped";
// Clone-watch outreach — Layer 2 (Netcraft submission), Layer 3+4 (brand
// notification), Layer 5 (weekly digest). Triggered by shopfront/clone.
// triaged.v1 emitted from /api/admin/clone-watch/triage. Plan:
// docs/plans/clone-watch-outreach.md.
import { cloneWatchSubmitNetcraft } from "./functions/clone-watch-submit-netcraft";
// Auto-report high-confidence branded clones to Netcraft without manual triage
// (gated FF_SHOPFRONT_CLONE_NETCRAFT_AUTO). Emits netcraft-auto.v1 → the
// submit-netcraft worker's second trigger. Needs post-deploy Inngest resync.
import { cloneWatchNetcraftAuto } from "./functions/clone-watch-netcraft-auto";
import { cloneWatchNotifyBrand } from "./functions/clone-watch-notify-brand";
import { cloneWatchWeeklyDigest } from "./functions/clone-watch-weekly-digest";
// Phase B — poll Netcraft for takedown status every 30 min. Powers the
// median time-to-takedown metric in the dashboard + weekly digest.
import { cloneWatchPollNetcraft } from "./functions/clone-watch-poll-netcraft";
// urlscan evidence — async 2-stage rebuild (v178): submit (gated on
// preclassify + SB/VT reputation) then a later batched retrieve. Replaces the
// old per-candidate submit→90s-poll monolith that timed out 100% of the time.
// scan-one is the operator-override single-candidate submit (admin scan button).
import { cloneWatchUrlscanSubmit } from "./functions/clone-watch-urlscan-submit";
import { cloneWatchUrlscanRetrieve } from "./functions/clone-watch-urlscan-retrieve";
import { cloneWatchUrlscanScanOne } from "./functions/clone-watch-urlscan-scan-one";
import { cloneWatchAutoTriage } from "./functions/clone-watch-auto-triage";
import { cloneWatchEnrichAttribution } from "./functions/clone-watch-enrich-attribution";
// PR-B2 — daily batch builder + Telegram approval flow (v151)
import { cloneWatchNotifyBrandPrepare } from "./functions/clone-watch-notify-brand-prepare";
// PR-D1 (#497) — weekly FP-cluster digest. Surfaces repeat FP patterns
// to the operator as proposed matcher exceptions. Operator-feedback loop.
import { cloneWatchFpClusterDigest } from "./functions/clone-watch-fp-cluster-digest";
// PR-D2 (#498) — Haiku 4.5 pre-classifier. Pre-ranks pending queue by
// confidence DESC. Writes to clone_watch_classifications sibling table
// (v157). Pre-rank only at this stage; auto-FP follows in PR-D5 (#501).
import { cloneWatchHaikuPreclassify } from "./functions/clone-watch-haiku-preclassify";
// WS2-cap — monthly Brand Stewardship Report aggregation + ledger.
import { reportBrandStewardship } from "./functions/report-brand-stewardship";
// Brand-contact coverage follow-ups: security.txt discovery (long-tail contacts)
// + internal all-clones digest to the operator (full picture incl. no-contact).
import { knownBrandsDiscover } from "./functions/known-brands-discover";
import { redditBrandsDiscover } from "./functions/reddit-brands-discover";
import { cloneWatchInternalDigest } from "./functions/clone-watch-internal-digest";
import { cloneWatchReportSummary } from "./functions/clone-watch-report-summary";
// Platform housekeeping (retention / rollup / push) — moved out of
// @askarthur/scam-engine in #588 (finding 2): these are platform jobs, not
// scam-analysis, so they don't belong in the engine package's module identity.
// Function IDs are unchanged, so the move is registration-location-only.
import { feedbackTriageRefresh } from "./functions/feedback-triage-refresh";
import { feedRetention } from "./functions/feed-retention";
import { regulatorAlertPush } from "./functions/regulator-alert-push";
import { phoneFootprintRetention } from "./functions/phone-footprint-retention";
import { redditProcessedPostsRetention } from "./functions/reddit-processed-posts-retention";
import { costTelemetryRetention } from "./functions/cost-telemetry-retention";
import { billingIngestNightly } from "./functions/billing-ingest-nightly";
import { telcoEventsRetention } from "./functions/telco-events-retention";
import { archiveShadowsRetention } from "./functions/archive-shadows-retention";

// App-layer Inngest functions live here because they cross apps/web-only
// primitives (R2 upload, Resend, local auth helpers) that shouldn't leak
// into the framework-free @askarthur/scam-engine package. Engine-side
// functions come in via inngestFunctions from scam-engine; anything else
// is concatenated here.
const appFunctions = [
  phoneFootprintPdfRender,
  phoneFootprintRefreshClaimer,
  phoneFootprintRefreshMonitor,
  phoneFootprintVonageBackfillPager,
  phoneFootprintVonageBackfillMonitor,
  // Onward reporting (v119)
  onwardBrandAbuse,
  onwardAcmaEmailSpam,
  onwardOpenphish,
  onwardApwg,
  onwardAutoReport,
  onwardScamwatch,
  onwardReportCyber,
  onwardIdcare,
  onwardAskArthurFeed,
  // Clone-watch outreach (v143)
  cloneWatchSubmitNetcraft,
  cloneWatchNetcraftAuto,
  cloneWatchNotifyBrand,
  cloneWatchWeeklyDigest,
  // Clone-watch measurement closure Phase B (v145)
  cloneWatchPollNetcraft,
  // Clone-watch urlscan evidence — async submit/retrieve rebuild (v178)
  cloneWatchUrlscanSubmit,
  cloneWatchUrlscanRetrieve,
  cloneWatchUrlscanScanOne,
  cloneWatchAutoTriage,
  cloneWatchEnrichAttribution,
  // Clone-watch approval-gated daily-batch builder (v151)
  cloneWatchNotifyBrandPrepare,
  // Clone-watch FP-cluster digest (PR-D1, #497)
  cloneWatchFpClusterDigest,
  // Clone-watch Haiku pre-classifier (PR-D2, #498, v157)
  cloneWatchHaikuPreclassify,
  // Brand-contact coverage follow-ups
  knownBrandsDiscover,
  redditBrandsDiscover,
  cloneWatchInternalDigest,
  cloneWatchReportSummary,
  // Brand Stewardship Report (WS2-cap)
  reportBrandStewardship,
  // Platform housekeeping — moved from @askarthur/scam-engine (#588 finding 2).
  // Retention/rollup/push crons; IDs unchanged.
  feedbackTriageRefresh,
  feedRetention,
  regulatorAlertPush,
  phoneFootprintRetention,
  redditProcessedPostsRetention,
  costTelemetryRetention,
  billingIngestNightly,
  telcoEventsRetention,
  archiveShadowsRetention,
];

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...inngestFunctions, ...appFunctions],
});
