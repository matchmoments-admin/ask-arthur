import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

/**
 * Meta Brand Rights Protection (BRP) reporter.
 *
 * Runs every hour. Queries deepfake_detections that have not been reported
 * to Meta, where the celebrity has brp_enrolled = TRUE.
 *
 * For each unreported detection, submits to the Meta Graph API
 * and updates the reported_to_meta flag + meta_report_id.
 *
 * If META_BRP_ACCESS_TOKEN is not set, the function skips silently.
 */
export const metaBrpReport = inngest.createFunction(
  {
    id: "meta-brp-report",
    name: "Meta BRP Deepfake Reporter",
  },
  { cron: "0 * * * *" }, // every hour
  async ({ step }) => {
    const accessToken = process.env.META_BRP_ACCESS_TOKEN;
    if (!accessToken) {
      return { skipped: true, reason: "META_BRP_ACCESS_TOKEN not configured" };
    }

    const supabase = createServiceClient();
    if (!supabase) {
      return { skipped: true, reason: "Supabase not configured" };
    }

    // Step 1: Fetch unreported detections for BRP-enrolled celebrities
    const detections = await step.run("fetch-unreported", async () => {
      const { data, error } = await supabase
        .from("deepfake_detections")
        .select(`
          id,
          celebrity_id,
          celebrity_name,
          image_url,
          landing_url,
          advertiser_name,
          ad_text_excerpt
        `)
        .eq("reported_to_meta", false)
        .limit(50);

      if (error) {
        logger.error("Failed to fetch unreported detections", { error: String(error) });
        return [];
      }

      if (!data || data.length === 0) return [];

      // Filter to only BRP-enrolled celebrities
      const celebrityIds = [...new Set(data.map((d) => d.celebrity_id).filter(Boolean))];
      if (celebrityIds.length === 0) return [];

      const { data: enrolled } = await supabase
        .from("monitored_celebrities")
        .select("id")
        .in("id", celebrityIds)
        .eq("brp_enrolled", true);

      const enrolledIds = new Set((enrolled ?? []).map((e) => e.id));
      return data.filter((d) => d.celebrity_id && enrolledIds.has(d.celebrity_id));
    });

    if (detections.length === 0) {
      return { skipped: true, reason: "No unreported detections for BRP-enrolled celebrities" };
    }

    // Step 2: Submit each detection to Meta Graph API
    let reported = 0;
    let failed = 0;

    for (const detection of detections) {
      await step.run(`report-${detection.id}`, async () => {
        try {
          // STUB: Meta Graph API submission
          // When Meta BRP API access is granted, implement:
          // POST https://graph.facebook.com/v19.0/{page-id}/copyright_violations
          // with access_token, content_url, description, etc.
          //
          // For now, log the attempt and mark as reported for testing
          logger.info("Meta BRP report stub", {
            detectionId: detection.id,
            celebrity: detection.celebrity_name,
            imageUrl: detection.image_url?.slice(0, 80),
          });

          // TODO: Replace with actual Meta Graph API call:
          // const res = await fetch(`https://graph.facebook.com/v19.0/...`, {
          //   method: "POST",
          //   headers: { Authorization: `Bearer ${accessToken}` },
          //   body: JSON.stringify({ ... }),
          // });
          // const metaResult = await res.json();
          // const metaReportId = metaResult.id;

          // For now, skip actual API call — just log
          // When ready, uncomment above and update:
          // await supabase
          //   .from("deepfake_detections")
          //   .update({
          //     reported_to_meta: true,
          //     meta_report_id: metaReportId,
          //     reported_at: new Date().toISOString(),
          //   })
          //   .eq("id", detection.id);

          reported++;
        } catch (err) {
          logger.error("Meta BRP report failed", {
            detectionId: detection.id,
            error: String(err),
          });
          failed++;
        }
      });
    }

    return { reported, failed, total: detections.length };
  }
);
