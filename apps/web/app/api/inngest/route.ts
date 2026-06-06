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
import { cloneWatchNotifyBrand } from "./functions/clone-watch-notify-brand";
import { cloneWatchWeeklyDigest } from "./functions/clone-watch-weekly-digest";
// Phase B — poll Netcraft for takedown status every 30 min. Powers the
// median time-to-takedown metric in the dashboard + weekly digest.
import { cloneWatchPollNetcraft } from "./functions/clone-watch-poll-netcraft";
// Phase A.3 — urlscan.io auto-scan + daily re-scan for clone-watch
// candidates. Catches parked-vs-active-phishing transitions early.
// Plan: docs/plans/clone-watch-outreach.md §15 Phase A.3.
import { cloneWatchUrlscan } from "./functions/clone-watch-urlscan";
import { cloneWatchUrlscanRescan } from "./functions/clone-watch-urlscan-rescan";
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
  cloneWatchNotifyBrand,
  cloneWatchWeeklyDigest,
  // Clone-watch measurement closure Phase B (v145)
  cloneWatchPollNetcraft,
  // Clone-watch measurement closure Phase A.3 (v148)
  cloneWatchUrlscan,
  cloneWatchUrlscanRescan,
  cloneWatchAutoTriage,
  cloneWatchEnrichAttribution,
  // Clone-watch approval-gated daily-batch builder (v151)
  cloneWatchNotifyBrandPrepare,
  // Clone-watch FP-cluster digest (PR-D1, #497)
  cloneWatchFpClusterDigest,
  // Clone-watch Haiku pre-classifier (PR-D2, #498, v157)
  cloneWatchHaikuPreclassify,
  // Brand Stewardship Report (WS2-cap)
  reportBrandStewardship,
];

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...inngestFunctions, ...appFunctions],
});
