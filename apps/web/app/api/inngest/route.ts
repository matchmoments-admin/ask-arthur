import { serve } from "inngest/next";
import type { NextRequest } from "next/server";
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
];

const handlers = serve({
  client: inngest,
  functions: [...inngestFunctions, ...appFunctions],
});

// Localise the duplicated NextRequest type boundary from inngest/next. Runtime
// handlers are unchanged; this only keeps Next's route export checker green.
type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, never>> },
) => void | Response | Promise<void | Response>;

export const GET = handlers.GET as unknown as RouteHandler;
export const POST = handlers.POST as unknown as RouteHandler;
export const PUT = handlers.PUT as unknown as RouteHandler;
