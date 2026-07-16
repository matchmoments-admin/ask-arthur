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
// Deep-link / audit markers (Scamwatch / ReportCyber / IDCARE / Ask-Arthur-feed)
// consolidated into one multi-trigger fn — 2026-07-12 fleet review.
import { onwardMarkers } from "./functions/onward-skipped";
// Clone-watch outreach — Layer 2 (Netcraft submission), Layer 3+4 (brand
// notification), Layer 5 (weekly digest). Triggered by shopfront/clone.
// triaged.v1 emitted from /api/admin/clone-watch/triage. Plan:
// docs/plans/clone-watch-outreach.md.
import { cloneWatchSubmitNetcraft } from "./functions/clone-watch-submit-netcraft";
// Auto-report high-confidence branded clones to Netcraft without manual triage
// (gated FF_SHOPFRONT_CLONE_NETCRAFT_AUTO). Emits netcraft-auto.v1 → the
// submit-netcraft worker's second trigger. Needs post-deploy Inngest resync.
import { cloneWatchNetcraftAuto } from "./functions/clone-watch-netcraft-auto";
import { cloneWatchNetcraftIssue } from "./functions/clone-watch-netcraft-issue";
import { cloneWatchNetcraftReconcile } from "./functions/clone-watch-netcraft-reconcile";
import { cloneWatchNotifyBrand } from "./functions/clone-watch-notify-brand";
import { cloneWatchWeeklyDigest } from "./functions/clone-watch-weekly-digest";
// Phase B — poll Netcraft for takedown status every 30 min. Powers the
// median time-to-takedown metric in the dashboard + weekly digest.
import { cloneWatchPollNetcraft } from "./functions/clone-watch-poll-netcraft";
// Lifecycle re-check loop (Wave 0 PR-B) — re-scans monitoring/declined
// lookalikes so a domain that weaponises after its first scan is caught and
// promoted to 'weaponised' (→ shopfront/clone.weaponised.v1).
import { cloneWatchLifecycleRecheck } from "./functions/clone-watch-lifecycle-recheck";
// Enforcement plan (Wave 1) — opens multi-channel takedown cases (audit record)
// when a lookalike weaponises. Opens cases only; sends stay human-gated.
import { cloneWatchEnforcementPlan } from "./functions/clone-watch-enforcement-plan";
// F1 (brand-value features) — the BRAND-facing weaponised.v1 consumer: stages
// an urgent single-alert batch for the four-eyes dashboard send the moment a
// monitored lookalike flips to likely_phishing. Gated FF_CLONE_WEAPONISED_ALERT.
import { cloneWatchNotifyWeaponised } from "./functions/clone-watch-notify-weaponised";
// Enforcement execute (Wave 1 outbound) — the ONLY machine-send path: auto-report
// weaponised lookalikes to APWG + OpenPhish, cap-bounded + canary-capable.
import { cloneWatchEnforcementExecute } from "./functions/clone-watch-enforcement-execute";
// Re-emergence monitor (Wave 1) — reopens 'actioned' cases whose taken-down
// domain resolves again. Read-only DNS + status flip; no outbound.
import { cloneWatchReemergenceMonitor } from "./functions/clone-watch-reemergence-monitor";
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
// Monthly intel-driven blog draft — mines all intel streams, drafts to Ghost.
import { monthlyIntelBlog } from "./functions/monthly-intel-blog";
// Brand-contact coverage follow-ups: security.txt discovery (long-tail contacts)
// + internal all-clones digest to the operator (full picture incl. no-contact).
import { knownBrandsDiscover } from "./functions/known-brands-discover";
import { redditBrandsDiscover } from "./functions/reddit-brands-discover";
import { brandRegisterRefresh } from "./functions/brand-register-refresh";
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
  onwardMarkers,
  // Clone-watch outreach (v143)
  cloneWatchSubmitNetcraft,
  cloneWatchNetcraftAuto,
  cloneWatchNetcraftIssue,
  cloneWatchNetcraftReconcile,
  cloneWatchNotifyBrand,
  cloneWatchWeeklyDigest,
  // Clone-watch measurement closure Phase B (v145)
  cloneWatchPollNetcraft,
  cloneWatchLifecycleRecheck,
  cloneWatchEnforcementPlan,
  // F1 — brand-facing weaponisation early-warning alert (v220)
  cloneWatchNotifyWeaponised,
  cloneWatchEnforcementExecute,
  cloneWatchReemergenceMonitor,
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
  brandRegisterRefresh,
  cloneWatchInternalDigest,
  cloneWatchReportSummary,
  // Brand Stewardship Report (WS2-cap)
  reportBrandStewardship,
  // Monthly intel-driven blog draft (replaces the retired weekly-blog cron)
  monthlyIntelBlog,
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

// Each HTTP call to this endpoint runs ONE Inngest step. Some steps (the
// clone-watch batch loops) intentionally run up to ~200s of external I/O, so
// the Vercel function must be allowed to run at least as long as the Inngest
// step's finish budget — otherwise Vercel kills the invocation first and Inngest
// replays the whole step (re-burning urlscan quota, and previously risking a
// dropped weaponised event). 300s matches the batch steps' 5-8m finish budgets
// within the platform cap.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...inngestFunctions, ...appFunctions],
});
