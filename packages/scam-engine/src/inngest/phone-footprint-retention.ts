// Nightly retention housekeeping for the phone-footprint domain.
//
// Wires up two RPCs that v75 created but no scheduler ever invoked:
//   1. anonymise_expired_footprints — UPDATE phone_footprints
//      SET msisdn_e164='REDACTED', pillar_scores='{}', explanation=NULL,
//          anonymised_at=NOW()
//      WHERE expires_at < NOW() - INTERVAL '7 days' AND anonymised_at IS NULL.
//      The 7-day grace is the documented privacy buffer (see migration-v75
//      header). Without this cron, expired E.164 numbers stayed in the
//      table indefinitely — compliance hazard before storage hazard.
//   2. sweep_inactive_monitors — UPDATE phone_footprint_monitors
//      SET status='consent_lapsed' for monitors whose consent_expires_at
//      has passed (status was 'active' AND soft_deleted_at IS NULL).
//      Stops further refreshes against numbers whose 13-month consent
//      window has elapsed.
//
// Both functions are idempotent (anonymise skips already-anonymised rows;
// sweep filters on status='active'), so retries are safe.
//
// Schedule: 03:15 UTC nightly (13:15 AEST). After feed-retention (02:30)
// and the daily scrape window; before any morning cron tier.
//
// Plan reference: phase 0.1 of the data-model improvement plan.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

import { inngest } from "./client";
import { logFunctionFailure } from "../cost-log";
import { withAxiomLogging } from "./with-axiom-logging";

export const phoneFootprintRetention = inngest.createFunction(
  {
    id: "phone-footprint-retention",
    name: "Phone Footprint: Nightly retention housekeeping",
    retries: 2,
    // Compliance job (PII anonymisation + consent lapse). A silent multi-day
    // failure leaves expired E.164 numbers in the table — page on permanent
    // failure (#522). logFunctionFailure writes a '%error%' cost_telemetry row
    // the daily health-digest turns into an admin Telegram.
    onFailure: async ({ error }) => {
      await logFunctionFailure(
        "phone-footprint-retention-error",
        "retention.failed",
        error,
      );
    },
  },
  { cron: "15 3 * * *" },
  withAxiomLogging({ fnId: "phone-footprint-retention" }, async ({ step }) => {
    // ── anonymise expired footprints (>7-day grace post expires_at) ─────
    const anonymised = await step.run("anonymise-expired-footprints", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");
      const { data, error } = await supabase.rpc("anonymise_expired_footprints");
      if (error) throw new Error(`anonymise_expired_footprints failed: ${error.message}`);
      return (data as number) ?? 0;
    });

    // ── lapse consent on monitors past consent_expires_at ───────────────
    const lapsed = await step.run("sweep-inactive-monitors", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");
      const { data, error } = await supabase.rpc("sweep_inactive_monitors");
      if (error) throw new Error(`sweep_inactive_monitors failed: ${error.message}`);
      return (data as number) ?? 0;
    });

    logger.info("phone-footprint-retention: complete", {
      anonymisedFootprints: anonymised,
      lapsedMonitors: lapsed,
    });

    return {
      anonymisedFootprints: anonymised,
      lapsedMonitors: lapsed,
    };
  }),
);
