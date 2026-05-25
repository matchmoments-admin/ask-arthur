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
];

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...inngestFunctions, ...appFunctions],
});
