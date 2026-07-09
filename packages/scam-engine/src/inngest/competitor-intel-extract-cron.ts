// Arthur's Watch Phase 2 — competitor-newsletter extraction cron.
//
// Cron-triggered (not event-triggered) because the producer is the Cloudflare
// Email Routing Worker -> intel-inbound-email Edge Function, which inserts into
// feed_items via PostgREST and has no Inngest client — same reason as
// feed-items-embed. Every 6h it finds competitor_intel feed_items that don't yet
// have observations and runs the extraction (one Sonnet call per newsletter),
// writing competitor_intel_observations (v212).
//
// INNGEST PROFILE (deliberately cheap + jump-proof):
//   - Cadence: `0 */6 * * *` = 4 runs/day. Flag-off runs return immediately.
//   - One step per newsletter (step id = feed_item id — deterministic across
//     replays, safe for Inngest), so each step is a SINGLE Sonnet call (~15s),
//     never an 8-call 8-minute block that could trip the pg-stuck-query
//     watchdog. Inngest checkpoints between newsletters.
//   - Per-row failures are CAUGHT inside the step and never re-thrown, so a bad
//     newsletter can't fail the function, force a full re-run, or make the
//     invocation count jump. The row stays unextracted and the next 6h run
//     retries it. Function-level retries=1 only covers a load-step DB blip.
//   - Idempotent: extractCompetitorObservations skips rows that already have
//     observations, so any replay/retry is a cheap no-op.
//
// OBSERVABILITY: fn lifecycle -> Axiom via withAxiomLogging (fn.error always
// ships). Per-extraction cost + volume -> cost_telemetry
// feature='competitor-intel-extract'. Per-row failures -> cost_telemetry
// feature='reddit-intel-error' (queryable alongside the rest of the subsystem's
// errors, same sink the weekly-email cron uses).
//
// Gated by FF_COMPETITOR_INTEL_EXTRACT (default OFF) + the shared
// feature_brakes.reddit_intel kill-switch (checked inside the extractor).

import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";

import { inngest } from "./client";
import { withAxiomLogging } from "./with-axiom-logging";
import { extractCompetitorObservations } from "../reddit-intel/competitor-intel-extract";

// Max newsletters extracted per run. Small — inflow is a few/week; a larger
// backlog simply drains over subsequent runs (idempotent).
const BATCH_LIMIT = 8;
// Only look back this far for candidates (bounds the scan as the table grows).
const LOOKBACK_DAYS = 45;
// Ceiling on candidate rows fetched before filtering out already-extracted ones.
const CANDIDATE_SCAN = 200;

export const competitorIntelExtractCron = inngest.createFunction(
  { id: "competitor-intel-extract", retries: 1 },
  { cron: "0 */6 * * *" },
  withAxiomLogging({ fnId: "competitor-intel-extract" }, async ({ step }) => {
    if (!featureFlags.competitorIntelExtract) {
      return { skipped: true, reason: "flag_off" };
    }

    const candidates = await step.run("load-unextracted", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");

      const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

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

    // One checkpointed step per newsletter. Deterministic step id (the feed_item
    // id) is replay-safe. Failures are caught here, recorded to the error sink,
    // and swallowed so the batch + invocation count stay stable.
    let totalObservations = 0;
    let failures = 0;
    for (const id of candidates) {
      const outcome = await step.run(`extract-${id}`, async () => {
        try {
          const res = await extractCompetitorObservations(id);
          return { observations: res.observations, error: false };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn("competitor-intel-extract: row failed", {
            feedItemId: id,
            error: message,
          });
          const sb = createServiceClient();
          if (sb) {
            await sb.from("cost_telemetry").insert({
              feature: "reddit-intel-error",
              provider: "diagnostic",
              operation: "competitor-intel-extract",
              units: 0,
              estimated_cost_usd: 0,
              metadata: { feed_item_id: id, error_message: message.slice(0, 500) },
            });
          }
          return { observations: 0, error: true };
        }
      });
      totalObservations += outcome.observations;
      if (outcome.error) failures += 1;
    }

    logger.info("competitor-intel-extract: batch done", {
      processed: candidates.length,
      totalObservations,
      failures,
    });

    return { processed: candidates.length, totalObservations, failures };
  }),
);
