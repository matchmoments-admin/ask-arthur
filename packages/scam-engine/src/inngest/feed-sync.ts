// Feed sync crons — sync verified_scams and user reports into feed_items table
// for the public scam feed. Runs every 15 minutes; each tick processes records
// created in the last LOOKBACK_MINUTES window. upsert_feed_item is idempotent on
// (source, external_id) so the overlap between consecutive ticks is a safe no-op.

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

// 20 min > 15 min cadence — tolerates one missed cron tick before records fall off the window.
const LOOKBACK_MINUTES = 20;
const LIMIT_PER_RUN = 500;

export const syncVerifiedScamsToFeed = inngest.createFunction(
  {
    id: "feed-sync-verified-scams",
    name: "Feed: Sync Verified Scams",
  },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    if (!featureFlags.dataPipeline) {
      return { skipped: true, reason: "dataPipeline feature flag disabled" };
    }

    const result = await step.run("sync-verified-scams", async () => {
      const supabase = createServiceClient();
      if (!supabase) {
        logger.warn("Supabase not configured, skipping verified scams sync");
        return { skipped: true, inserted: 0 };
      }

      const cutoff = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();

      const { data: scams, error: fetchErr } = await supabase
        .from("verified_scams")
        .select("id, impersonated_brand, scam_type, summary, channel, screenshot_key, region, created_at")
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(LIMIT_PER_RUN);

      if (fetchErr || !scams) {
        logger.error("Failed to fetch verified scams", { error: String(fetchErr) });
        throw new Error(`Fetch verified scams failed: ${fetchErr?.message}`);
      }

      if (scams.length === 0) {
        logger.info("No verified scams to sync");
        return { inserted: 0 };
      }

      let inserted = 0;
      for (const vs of scams) {
        const { data, error: upsertErr } = await supabase.rpc("upsert_feed_item", {
          p_source: "verified_scam",
          p_external_id: String(vs.id),
          p_title: `${vs.impersonated_brand || vs.scam_type || "Scam"} scam alert`,
          p_description: vs.summary || null,
          p_category: vs.scam_type || null,
          p_channel: vs.channel || null,
          p_r2_image_key: vs.screenshot_key || null,
          p_impersonated_brand: vs.impersonated_brand || null,
          p_country_code: vs.region || "AU",
          p_verified: true,
          p_source_created_at: vs.created_at,
        });

        if (upsertErr) {
          logger.warn("Failed to upsert verified scam feed item", {
            scamId: vs.id,
            error: String(upsertErr),
          });
          continue;
        }

        const result = typeof data === "string" ? JSON.parse(data) : data;
        if (result?.is_new) inserted++;
      }

      logger.info("Verified scams synced to feed", { total: scams.length, inserted });
      return { total: scams.length, inserted };
    });

    return result;
  }
);

export const syncUserReportsToFeed = inngest.createFunction(
  {
    id: "feed-sync-user-reports",
    name: "Feed: Sync User Reports",
  },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    if (!featureFlags.dataPipeline) {
      return { skipped: true, reason: "dataPipeline feature flag disabled" };
    }

    const result = await step.run("sync-user-reports", async () => {
      const supabase = createServiceClient();
      if (!supabase) {
        logger.warn("Supabase not configured, skipping user reports sync");
        return { skipped: true, inserted: 0 };
      }

      const cutoff = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();

      // Only sync HIGH_RISK reports without a verified_scams counterpart
      // (reports linked to verified_scams are covered by syncVerifiedScamsToFeed)
      const { data: reports, error: fetchErr } = await supabase
        .from("scam_reports")
        .select("id, impersonated_brand, scam_type, scrubbed_content, channel, country_code, source, created_at")
        .eq("verdict", "HIGH_RISK")
        .is("verified_scam_id", null)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(LIMIT_PER_RUN);

      if (fetchErr || !reports) {
        logger.error("Failed to fetch user reports", { error: String(fetchErr) });
        throw new Error(`Fetch user reports failed: ${fetchErr?.message}`);
      }

      if (reports.length === 0) {
        logger.info("No user reports to sync");
        return { inserted: 0 };
      }

      let inserted = 0;
      for (const sr of reports) {
        const { data, error: upsertErr } = await supabase.rpc("upsert_feed_item", {
          p_source: "user_report",
          p_external_id: String(sr.id),
          p_title: `${sr.impersonated_brand || sr.scam_type || "Scam"} reported via ${sr.source || "web"}`,
          p_description: sr.scrubbed_content ? sr.scrubbed_content.slice(0, 500) : null,
          p_category: sr.scam_type || null,
          p_channel: sr.channel || null,
          p_impersonated_brand: sr.impersonated_brand || null,
          p_country_code: sr.country_code || null,
          p_source_created_at: sr.created_at,
        });

        if (upsertErr) {
          logger.warn("Failed to upsert user report feed item", {
            reportId: sr.id,
            error: String(upsertErr),
          });
          continue;
        }

        const result = typeof data === "string" ? JSON.parse(data) : data;
        if (result?.is_new) inserted++;
      }

      logger.info("User reports synced to feed", { total: reports.length, inserted });
      return { total: reports.length, inserted };
    });

    return result;
  }
);
