// Push notifications for newly-ingested regulator narratives.
//
// Why this exists: scam-alerts.ts triggers a push only when 3+ user reports
// stack on a single URL within 3h. A single ASIC or Scamwatch alert is
// authoritative — a regulator publishing a warning is more signal than 100
// user reports. This cron reacts to those at near-real-time (30 min).
//
// Dedup: PK on regulator_alert_pushes.feed_item_id. A second cron tick that
// races the first will hit a conflict on INSERT; we treat that as "already
// pushed" and skip. The query also filters out already-pushed rows so the
// hot path avoids the conflict entirely.
//
// Flag-gating: reuses featureFlags.pushAlerts. Conceptually the same product
// surface as scam-alerts (mobile push); flipping pushAlerts off pauses both.

import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";

import { inngest } from "./client";
import { sendPushNotifications } from "../push-sender";

const SOURCE_LABEL: Record<string, string> = {
  scamwatch_alert: "ACCC Scamwatch",
  acsc: "ASD ACSC",
  asic_investor: "ASIC",
};

const LOOKBACK_MINUTES = 60; // catch anything ingested in the last hour
const MAX_PER_TICK = 10;     // safety cap — never push >10 narratives per cron tick

interface NarrativeRow {
  id: number;
  source: string;
  title: string;
  external_id: string | null;
  url: string | null;
}

export const regulatorAlertPush = inngest.createFunction(
  {
    id: "regulator-alert-push",
    name: "News Intel: Push regulator alerts",
    retries: 2,
  },
  { cron: "*/30 * * * *" },
  async ({ step }) => {
    if (!featureFlags.pushAlerts) {
      return { skipped: true, reason: "pushAlerts flag disabled" };
    }

    // ── Step 1: find new narratives that haven't been pushed yet ──────────
    const candidates = await step.run("fetch-new-narratives", async () => {
      const supabase = createServiceClient();
      if (!supabase) return [];
      const since = new Date(
        Date.now() - LOOKBACK_MINUTES * 60 * 1000,
      ).toISOString();
      const { data, error } = await supabase
        .from("feed_items")
        .select("id, source, title, external_id, url")
        .in("source", ["scamwatch_alert", "acsc", "asic_investor"])
        .eq("published", true)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(MAX_PER_TICK * 4); // overfetch so the dedup filter has headroom

      if (error) {
        logger.error("regulator-alert-push: feed_items query failed", {
          error: error.message,
        });
        return [];
      }
      const rows = (data ?? []) as NarrativeRow[];
      if (rows.length === 0) return [];

      // Filter out anything already in regulator_alert_pushes.
      const ids = rows.map((r) => r.id);
      const { data: pushed, error: pushedErr } = await supabase
        .from("regulator_alert_pushes")
        .select("feed_item_id")
        .in("feed_item_id", ids);
      if (pushedErr) {
        logger.error("regulator-alert-push: dedup query failed", {
          error: pushedErr.message,
        });
        return [];
      }
      const pushedIds = new Set((pushed ?? []).map((p) => p.feed_item_id));
      return rows.filter((r) => !pushedIds.has(r.id)).slice(0, MAX_PER_TICK);
    });

    if (candidates.length === 0) {
      return { skipped: true, reason: "no_new_narratives" };
    }

    // ── Step 2: fetch active push tokens (reuse scam-alerts pattern) ──────
    const tokens = await step.run("fetch-tokens", async () => {
      const supabase = createServiceClient();
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("device_push_tokens")
        .select("expo_token")
        .eq("active", true)
        .limit(10000);
      if (error) {
        logger.error("regulator-alert-push: token query failed", {
          error: error.message,
        });
        return [];
      }
      return (data ?? []).map((d) => d.expo_token as string);
    });

    if (tokens.length === 0) {
      return { skipped: true, reason: "no_active_tokens" };
    }

    // ── Step 3: per-narrative push fan-out ────────────────────────────────
    // We push one notification PER narrative (not bundled) because
    // regulator alerts are authoritative — bundling them dilutes the signal.
    // Each narrative writes its own dedup row.
    const results = await step.run("send-and-record", async () => {
      const supabase = createServiceClient();
      if (!supabase) return { sent: 0, failed: 0, recorded: 0 };

      let totalSent = 0;
      let totalFailed = 0;
      let recorded = 0;

      for (const narrative of candidates) {
        const sourceLabel =
          SOURCE_LABEL[narrative.source] ?? narrative.source;
        const body = narrative.title;
        const messages = tokens.map((token) => ({
          to: token,
          title: `Regulator alert: ${sourceLabel}`,
          body,
          sound: "default" as const,
          channelId: "scam-alerts",
          priority: "high" as const,
          data: {
            type: "regulator_alert",
            source: narrative.source,
            feedItemId: narrative.id,
            url:
              narrative.url ??
              `https://askarthur.au/intel/regulator-alerts#${narrative.external_id ?? ""}`,
          },
        }));

        const tickets = await sendPushNotifications(messages);
        const sent = tickets.filter((t) => t.status === "ok").length;
        const failed = tickets.filter((t) => t.status === "error").length;
        totalSent += sent;
        totalFailed += failed;

        // Record dedup row. ON CONFLICT DO NOTHING handles a concurrent
        // tick that races us — the loser silently no-ops.
        const { error } = await supabase
          .from("regulator_alert_pushes")
          .upsert(
            {
              feed_item_id: narrative.id,
              recipient_count: sent,
              error_count: failed,
              pushed_at: new Date().toISOString(),
            },
            { onConflict: "feed_item_id", ignoreDuplicates: true },
          );
        if (error) {
          logger.warn("regulator-alert-push: dedup insert failed", {
            feed_item_id: narrative.id,
            error: error.message,
          });
        } else {
          recorded += 1;
        }
      }

      return { sent: totalSent, failed: totalFailed, recorded };
    });

    logger.info("regulator-alert-push: complete", {
      narratives: candidates.length,
      tokens: tokens.length,
      ...results,
    });

    return {
      narratives: candidates.length,
      tokens: tokens.length,
      ...results,
    };
  },
);
