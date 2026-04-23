import { inngest } from "./client";
import { logger } from "@askarthur/utils/logger";
import { createBrandAlert } from "../brand-alerts";
import {
  ANALYZE_COMPLETED_EVENT,
  parseAnalyzeCompletedData,
} from "./events";

// Durable consumer for analyze.completed.v1 — emits a
// brand_impersonation_alerts row when the AI identified an impersonated
// brand and the verdict is non-SAFE. Replaces the dynamic-import +
// waitUntil block in analyze/route.ts.
//
// Idempotency: brand_impersonation_alerts is append-only for aggregation.
// Duplicate rows on retry would inflate counts but not cause correctness
// issues. Function-level idempotency (event.data.requestId) is the primary
// guard; no DB-level dedup needed.

export const handleAnalyzeCompletedBrand = inngest.createFunction(
  {
    id: "analyze-completed-brand",
    name: "Analyze: Create brand impersonation alert",
    idempotency: "event.data.requestId",
    retries: 2,
  },
  { event: ANALYZE_COMPLETED_EVENT },
  async ({ event, step }) => {
    const data = await step.run("parse-event", () =>
      parseAnalyzeCompletedData(event.data)
    );

    if (!data.impersonatedBrand) {
      return { skipped: true, reason: "no impersonated brand" };
    }
    if (data.verdict === "SAFE") {
      // Matches existing route.ts:430 guard: brand alerts only fire when
      // the verdict is non-SAFE (no point alerting about an unimpersonated
      // legitimate communication that happens to name a brand).
      return { skipped: true, reason: "verdict=SAFE" };
    }

    await step.run("create-brand-alert", async () => {
      await createBrandAlert({
        brandName: data.impersonatedBrand!,
        scamType: data.scamType,
        channel: data.channel,
        confidence: data.confidence,
        scammerPhones: data.scammerContacts?.phoneNumbers.map((p) => p.value) ?? [],
        scammerUrls: data.urlResults?.slice(0, 10).map((u) => u.url) ?? [],
        scammerEmails: data.scammerContacts?.emailAddresses.map((e) => e.value) ?? [],
        summary: data.summary,
      });
    });

    logger.info("analyze.brand.alerted", {
      requestId: data.requestId,
      brand: data.impersonatedBrand,
      verdict: data.verdict,
    });

    return { alerted: true, brand: data.impersonatedBrand };
  }
);
