// Arthur's Watch Phase 2 — competitor-newsletter extraction cron.
//
// Cron-triggered (not event-triggered) because the producer is the Cloudflare
// Email Routing Worker -> intel-inbound-email Edge Function, which inserts into
// feed_items via PostgREST and has no Inngest client — same reason as
// feed-items-embed. Every 6h finds competitor_intel feed_items that don't yet
// have observations and runs the extraction (one Sonnet call per newsletter),
// writing competitor_intel_observations (v212).
//
// Gated by FF_COMPETITOR_INTEL_EXTRACT (default OFF) and the shared
// feature_brakes.reddit_intel kill-switch (checked inside
// extractCompetitorObservations). Low volume (a handful of newsletters/week) so
// a small per-run batch is plenty; a backlog simply drains over subsequent runs
// (extraction is idempotent — already-extracted rows are skipped).

import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";

import { inngest } from "./client";
import { withAxiomLogging } from "./with-axiom-logging";
import { extractCompetitorObservations } from "../reddit-intel/competitor-intel-extract";

// How many newsletters to extract per run. Small — inflow is a few/week.
const BATCH_LIMIT = 8;
// Only look back this far for candidates (avoids re-scanning ancient rows once
// the table grows). Comfortably covers the weekly/biweekly cadences.
const LOOKBACK_DAYS = 45;
// Ceiling on candidate rows fetched before filtering out already-extracted ones.
const CANDIDATE_SCAN = 200;

export const competitorIntelExtractCron = inngest.createFunction(
  {
    id: "competitor-intel-extract",
    // One retry — the underlying Sonnet call has its own timeout; a transient
    // failure on one newsletter shouldn't wedge the batch.
    retries: 1,
  },
  { cron: "0 */6 * * *" },
  withAxiomLogging({ fnId: "competitor-intel-extract" }, async ({ step }) => {
    if (!featureFlags.competitorIntelExtract) {
      return { skipped: true, reason: "flag_off" };
    }

    const candidates = await step.run("load-unextracted", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");

      const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

      // Recent competitor_intel newsletters.
      const { data: items, error: itemsErr } = await supabase
        .from("feed_items")
        .select("id")
        .eq("category", "competitor_intel")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(CANDIDATE_SCAN);
      if (itemsErr) throw new Error(`load candidates: ${itemsErr.message}`);

      const ids = (items ?? []).map((r) => r.id as number);
      if (ids.length === 0) return [] as number[];

      // Which of those already have observations?
      const { data: done, error: doneErr } = await supabase
        .from("competitor_intel_observations")
        .select("feed_item_id")
        .in("feed_item_id", ids);
      if (doneErr) throw new Error(`load extracted: ${doneErr.message}`);

      const extracted = new Set((done ?? []).map((r) => r.feed_item_id as number));
      return ids.filter((id) => !extracted.has(id)).slice(0, BATCH_LIMIT);
    });

    if (candidates.length === 0) {
      return { skipped: true, reason: "no_unextracted_rows" };
    }

    // Extract each in its own step so one bad newsletter can't fail the batch
    // (and so Inngest checkpoints progress). Errors are logged, not thrown.
    const results = await step.run("extract", async () => {
      const out: Array<{ feedItemId: number; observations: number; skipped?: string; error?: string }> = [];
      for (const id of candidates) {
        try {
          const r = await extractCompetitorObservations(id);
          out.push(r);
        } catch (err) {
          logger.warn("competitor-intel-extract: row failed", {
            feedItemId: id,
            error: err instanceof Error ? err.message : String(err),
          });
          out.push({ feedItemId: id, observations: 0, error: "extract_failed" });
        }
      }
      return out;
    });

    const totalObservations = results.reduce((s, r) => s + r.observations, 0);
    logger.info("competitor-intel-extract: batch done", {
      processed: results.length,
      totalObservations,
    });

    return {
      processed: results.length,
      totalObservations,
      results,
    };
  }),
);
