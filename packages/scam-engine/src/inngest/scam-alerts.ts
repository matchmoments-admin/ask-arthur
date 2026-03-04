import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { sendPushNotifications, buildScamAlertMessage } from "../push-sender";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";

/**
 * Scam alert push system (B2).
 * Runs every 3 hours, queries new HIGH-confidence threats,
 * and sends push notifications to active mobile devices.
 */
export const scamAlertCron = inngest.createFunction(
  {
    id: "scam-alert-push",
    name: "Scam Alert Push Notifications",
  },
  { cron: "0 */3 * * *" },
  async ({ step }) => {
    if (!featureFlags.pushAlerts) {
      return { skipped: true, reason: "pushAlerts flag disabled" };
    }

    const supabase = createServiceClient();
    if (!supabase) {
      return { skipped: true, reason: "Supabase not configured" };
    }

    // Step 1: Find new HIGH-confidence threats since last run (3 hours)
    const threats = await step.run("fetch-new-threats", async () => {
      const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from("scam_urls")
        .select("domain, scam_type, report_count")
        .gte("created_at", since)
        .gte("report_count", 3)
        .order("report_count", { ascending: false })
        .limit(20);

      if (error) {
        logger.error("Failed to fetch threats for alerts", { error });
        return [];
      }

      return data ?? [];
    });

    if (threats.length === 0) {
      return { sent: 0, reason: "No new high-confidence threats" };
    }

    // Step 2: Compose alert summary
    const alertSummary = await step.run("compose-alert", async () => {
      const types = new Map<string, number>();
      for (const t of threats) {
        const type = t.scam_type ?? "Unknown";
        types.set(type, (types.get(type) ?? 0) + 1);
      }

      const parts: string[] = [];
      for (const [type, count] of types) {
        parts.push(`${count} new ${type.toLowerCase()} scam${count > 1 ? "s" : ""}`);
      }

      return parts.join(", ") + " detected in Australia. Stay vigilant!";
    });

    // Step 3: Fetch active push tokens
    const tokens = await step.run("fetch-tokens", async () => {
      const { data, error } = await supabase
        .from("device_push_tokens")
        .select("expo_token")
        .eq("active", true)
        .limit(10000);

      if (error) {
        logger.error("Failed to fetch push tokens", { error });
        return [];
      }

      return (data ?? []).map((d) => d.expo_token);
    });

    if (tokens.length === 0) {
      return { sent: 0, reason: "No active push tokens" };
    }

    // Step 4: Send push notifications
    const result = await step.run("send-alerts", async () => {
      const primaryType = threats[0]?.scam_type ?? "Security";
      const messages = tokens.map((token) =>
        buildScamAlertMessage(token, primaryType, alertSummary)
      );

      const tickets = await sendPushNotifications(messages);
      const sent = tickets.filter((t) => t.status === "ok").length;
      const failed = tickets.filter((t) => t.status === "error").length;

      logger.info("Scam alerts sent", { sent, failed, total: tokens.length });
      return { sent, failed };
    });

    return result;
  }
);
