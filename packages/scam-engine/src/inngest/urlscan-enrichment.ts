// URLScan.io async enrichment — runs 30 min after entity enrichment.
// Finds URL entities that have completed enrichment but no urlscan data,
// submits up to 20 for scanning, waits 60s, then retrieves and stores results.

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { submitURLScan, retrieveURLScan } from "../urlscan";

const MAX_URLS_PER_RUN = 20;

export const urlscanEnrichment = inngest.createFunction(
  {
    id: "pipeline-urlscan-enrichment",
    name: "Pipeline: URLScan.io Async Enrichment",
    concurrency: { limit: 1 },
    // urlscan.io is metered (paid tier ~$0.03/scan; free tier ~100 scans/day).
    // The cron paces submissions to ~20 URLs every 4h, but a manual re-trigger
    // burst would blow through the free-tier budget in seconds. Outer rateLimit
    // prevents storms; throttle caps submissions across runs as a global lid.
    rateLimit: { limit: 1, period: "10m" },
    throttle: { limit: 50, period: "1h", key: "urlscan-submissions" },
  },
  { cron: "30 */4 * * *" }, // 30 min after entity enrichment
  async ({ step }) => {
    if (!featureFlags.urlScanIO) {
      return { skipped: true, reason: "urlScanIO feature flag disabled" };
    }

    if (!process.env.URLSCAN_API_KEY) {
      return { skipped: true, reason: "URLSCAN_API_KEY not set" };
    }

    // Step 1: Find URL entities with completed enrichment but no urlscan data
    const urlEntities = await step.run("fetch-url-entities", async () => {
      const supabase = createServiceClient();
      if (!supabase) return [];

      const { data, error } = await supabase
        .from("scam_entities")
        .select("id, normalized_value, enrichment_data")
        .eq("entity_type", "url")
        .eq("enrichment_status", "completed")
        .gte("report_count", 3)
        .order("report_count", { ascending: false })
        .limit(MAX_URLS_PER_RUN);

      if (error) {
        logger.error("Failed to fetch URL entities for urlscan", {
          error: String(error),
        });
        throw new Error(error.message);
      }

      // Filter out entities that already have urlscan data
      return (data || [])
        .filter((row) => {
          const enrichment = row.enrichment_data as Record<string, unknown> | null;
          return !enrichment?.urlscan;
        })
        .map((row) => ({
          id: row.id,
          url: row.normalized_value as string,
        }));
    });

    if (urlEntities.length === 0) {
      return { scanned: 0, reason: "no URL entities need urlscan" };
    }

    // Step 2: Submit URLs for scanning
    const submissions = await step.run("submit-urls", async () => {
      const results: { entityId: number; uuid: string; url: string }[] = [];

      for (const entity of urlEntities) {
        const submission = await submitURLScan(entity.url);
        if (submission) {
          results.push({
            entityId: entity.id,
            uuid: submission.uuid,
            url: entity.url,
          });
        }
        // 1s delay between submissions to be polite
        if (entity !== urlEntities[urlEntities.length - 1]) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      return results;
    });

    if (submissions.length === 0) {
      return { scanned: 0, reason: "no URLs were successfully submitted" };
    }

    // Step 3: Wait 60s for scans to complete
    await step.sleep("wait-for-scans", "60s");

    // Step 4: Retrieve results and merge into enrichment_data
    const retrievalResults = await step.run("retrieve-results", async () => {
      const supabase = createServiceClient();
      if (!supabase) return { retrieved: 0, failed: 0 };

      let retrieved = 0;
      let failed = 0;

      for (const sub of submissions) {
        try {
          const result = await retrieveURLScan(sub.uuid);
          if (!result) {
            failed++;
            continue;
          }

          // Merge urlscan result into existing enrichment_data
          const { data: entity } = await supabase
            .from("scam_entities")
            .select("enrichment_data")
            .eq("id", sub.entityId)
            .single();

          const existingData = (entity?.enrichment_data as Record<string, unknown>) || {};
          const updatedData = { ...existingData, urlscan: result };

          await supabase
            .from("scam_entities")
            .update({ enrichment_data: updatedData })
            .eq("id", sub.entityId);

          retrieved++;
        } catch (err) {
          logger.error("URLScan retrieval failed for entity", {
            entityId: sub.entityId,
            uuid: sub.uuid,
            error: String(err),
          });
          failed++;
        }

        // 500ms delay between retrievals
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      return { retrieved, failed };
    });

    logger.info("URLScan enrichment complete", {
      submitted: submissions.length,
      ...retrievalResults,
    });

    return { submitted: submissions.length, ...retrievalResults };
  }
);
