// Nightly retention housekeeping for the telco event tables.
//
// Single RPC `prune_telco_events()` returns one row per table with
// deletion count, keeping observability simple. Retention windows:
//   - 730d: sim_swap_events, device_swap_events (forensic; account-
//     takeover investigations look back 18+ months)
//   - 365d: subscriber_match_checks, telco_signal_history,
//     telco_api_usage, phone_lookups, phone_footprint_otp_attempts
//
// Schedule: 04:30 UTC nightly (14:30 AEST). After cost-telemetry
// retention (04:00) so the four-step nightly retention pipeline runs
// in dependency order: feed → phone footprint → reddit → cost → telco.
//
// Plan reference: phase 2.3 of the data-model improvement plan.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

import { inngest } from "@askarthur/scam-engine/inngest/client";
import { logFunctionFailure } from "@askarthur/scam-engine/cost-log";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";

type PruneResult = { table_name: string; rows_deleted: number };

export const telcoEventsRetention = inngest.createFunction(
  {
    id: "telco-events-retention",
    timeouts: { finish: "4m" },
    name: "Telco Events: Nightly retention housekeeping",
    retries: 2,
    // Forensic-retention compliance job. Page on permanent failure (#522) so a
    // silent multi-day stall doesn't let the 730d/365d windows drift —
    // surfaced via the daily health-digest's '%error%' aggregation.
    onFailure: async ({ error }) => {
      await logFunctionFailure(
        "telco-events-retention-error",
        "retention.failed",
        error,
      );
    },
  },
  { cron: "30 4 * * *" },
  withAxiomLogging({ fnId: "telco-events-retention" }, async ({ step }) => {
    const results = await step.run("prune-telco-events", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");
      const { data, error } = await supabase.rpc("prune_telco_events");
      if (error) throw new Error(`prune_telco_events failed: ${error.message}`);
      return (data as PruneResult[]) ?? [];
    });

    const summary = Object.fromEntries(
      results.map((r) => [r.table_name, r.rows_deleted]),
    );
    logger.info("telco-events-retention: complete", summary);

    return summary;
  }),
);
