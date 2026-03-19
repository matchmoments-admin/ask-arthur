// Feed sync crons — sync verified_scams and user reports into feed_items table
// for the public scam feed. Runs every 15 minutes.

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

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
        return { skipped: true };
      }

      const { data, error } = await supabase.rpc("exec_sql", {
        query: `
          INSERT INTO feed_items (source, external_id, title, description, category, channel,
            r2_image_key, impersonated_brand, country_code, verified, source_created_at)
          SELECT
            'verified_scam',
            vs.id::text,
            COALESCE(vs.impersonated_brand, vs.scam_type, 'Scam') || ' scam alert',
            vs.summary,
            vs.scam_type,
            vs.channel,
            vs.screenshot_key,
            vs.impersonated_brand,
            COALESCE(vs.region, 'AU'),
            TRUE,
            vs.created_at
          FROM verified_scams vs
          LEFT JOIN feed_items fi ON fi.source = 'verified_scam' AND fi.external_id = vs.id::text
          WHERE fi.id IS NULL
            AND vs.created_at > NOW() - INTERVAL '7 days'
          LIMIT 50
          RETURNING id
        `,
      });

      if (error) {
        // exec_sql may not exist — fall back to raw SQL via postgrest
        logger.warn("exec_sql RPC not available, using direct insert", {
          error: String(error),
        });

        // Use direct Supabase query as fallback
        const { data: scams, error: fetchErr } = await supabase
          .from("verified_scams")
          .select("id, impersonated_brand, scam_type, summary, channel, screenshot_key, region, created_at")
          .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .order("created_at", { ascending: false })
          .limit(50);

        if (fetchErr || !scams) {
          logger.error("Failed to fetch verified scams", { error: String(fetchErr) });
          throw new Error(`Fetch verified scams failed: ${fetchErr?.message}`);
        }

        let inserted = 0;
        for (const vs of scams) {
          // Check if already synced
          const { data: existing } = await supabase
            .from("feed_items")
            .select("id")
            .eq("source", "verified_scam")
            .eq("external_id", String(vs.id))
            .limit(1);

          if (existing && existing.length > 0) continue;

          const { error: insertErr } = await supabase.from("feed_items").insert({
            source: "verified_scam",
            external_id: String(vs.id),
            title: `${vs.impersonated_brand || vs.scam_type || "Scam"} scam alert`,
            description: vs.summary,
            category: vs.scam_type,
            channel: vs.channel,
            r2_image_key: vs.screenshot_key,
            impersonated_brand: vs.impersonated_brand,
            country_code: vs.region || "AU",
            verified: true,
            source_created_at: vs.created_at,
          });

          if (!insertErr) inserted++;
        }

        logger.info("Verified scams synced to feed (fallback)", { inserted });
        return { inserted };
      }

      const count = Array.isArray(data) ? data.length : 0;
      logger.info("Verified scams synced to feed", { count });
      return { inserted: count };
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
        return { skipped: true };
      }

      // Only sync HIGH_RISK reports (quality filter)
      const { data: reports, error: fetchErr } = await supabase
        .from("scam_reports")
        .select("id, impersonated_brand, scam_type, scrubbed_content, channel, country_code, source, created_at")
        .eq("verdict", "HIGH_RISK")
        .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(50);

      if (fetchErr || !reports) {
        logger.error("Failed to fetch user reports", { error: String(fetchErr) });
        throw new Error(`Fetch user reports failed: ${fetchErr?.message}`);
      }

      let inserted = 0;
      for (const sr of reports) {
        // Check if already synced
        const { data: existing } = await supabase
          .from("feed_items")
          .select("id")
          .eq("source", "user_report")
          .eq("external_id", String(sr.id))
          .limit(1);

        if (existing && existing.length > 0) continue;

        const { error: insertErr } = await supabase.from("feed_items").insert({
          source: "user_report",
          external_id: String(sr.id),
          title: `${sr.impersonated_brand || sr.scam_type || "Scam"} reported via ${sr.source || "web"}`,
          description: sr.scrubbed_content ? sr.scrubbed_content.slice(0, 500) : null,
          category: sr.scam_type,
          channel: sr.channel,
          impersonated_brand: sr.impersonated_brand,
          country_code: sr.country_code,
          source_created_at: sr.created_at,
        });

        if (!insertErr) inserted++;
      }

      logger.info("User reports synced to feed", { inserted });
      return { inserted };
    });

    return result;
  }
);
