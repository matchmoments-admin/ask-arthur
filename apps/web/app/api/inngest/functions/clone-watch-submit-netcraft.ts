import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import {
  CLONE_WATCH_TRIAGED_EVENT,
  parseCloneWatchTriagedData,
} from "@askarthur/scam-engine/inngest/events";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";

/**
 * Layer 2 — Submit a TP-confirmed clone-watch hit to Netcraft for
 * community-blocklist + browser-block coverage. Netcraft's median takedown
 * time is 33 minutes; their submission feeds Safe Browsing + AV vendors.
 *
 * Gating:
 *   - FF_SHOPFRONT_CLONE_SUBMIT_NETCRAFT must be 'true'
 *   - NETCRAFT_REPORT_API_KEY must be set
 *   - Per-pairing dedupe: skip if shopfront_clone_alerts.submitted_to.netcraft
 *     already records this submission
 *
 * When credentials are missing the function logs a no-op skip so the rest of
 * the fan-out (brand notification) still proceeds and the operator can wire
 * the key when convenient.
 *
 * See docs/plans/clone-watch-outreach.md §6 Phase 2.
 */
// Netcraft v3 submit endpoint is /report/urls (the changelog + the akacdev
// client confirm /report/urls with urls[n] as objects, returning {uuid,state}).
// The earlier /report path 404s.
const NETCRAFT_REPORT_ENDPOINT = "https://report.netcraft.com/api/v3/report/urls";

export const cloneWatchSubmitNetcraft = inngest.createFunction(
  {
    id: "shopfront-clone-submit-netcraft",
    name: "Clone-Watch: Submit to Netcraft",
    retries: 3,
    concurrency: { limit: 4 },
    idempotency: "event.data.alertId",
  },
  { event: CLONE_WATCH_TRIAGED_EVENT },
  withAxiomLogging({ fnId: "shopfront-clone-submit-netcraft" }, async ({ event, step }) => {
    const data = parseCloneWatchTriagedData(event.data);

    if (!featureFlags.shopfrontCloneOutreach) {
      return { skipped: true, reason: "FF_SHOPFRONT_CLONE_OUTREACH disabled" };
    }
    if (!featureFlags.shopfrontCloneSubmitNetcraft) {
      return {
        skipped: true,
        reason: "FF_SHOPFRONT_CLONE_SUBMIT_NETCRAFT disabled",
      };
    }
    const apiKey = process.env.NETCRAFT_REPORT_API_KEY;
    if (!apiKey) {
      logger.warn("clone-watch netcraft: NETCRAFT_REPORT_API_KEY not set");
      return { skipped: true, reason: "NETCRAFT_REPORT_API_KEY not set" };
    }

    // Dedup — never re-submit the same alert.
    const alreadySubmitted = await step.run("check-dedup", async () => {
      const sb = createServiceClient();
      if (!sb) return false;
      const { data: row } = await sb
        .from("shopfront_clone_alerts")
        .select("submitted_to")
        .eq("id", data.alertId)
        .maybeSingle();
      const submitted_to =
        (row?.submitted_to as Record<string, unknown> | null) ?? {};
      return Boolean(submitted_to.netcraft);
    });
    if (alreadySubmitted) {
      return { skipped: true, reason: "already_submitted" };
    }

    const submission = await step.run("submit-netcraft", async () => {
      const body = {
        email: process.env.NETCRAFT_REPORTER_EMAIL ?? "brendan@askarthur.au",
        reason: buildSubmissionReason(data),
        urls: [
          {
            url: data.candidateUrl,
            country: "AU",
          },
        ],
      };
      const res = await fetch(NETCRAFT_REPORT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
      if (!res.ok) {
        throw new Error(
          `Netcraft submit HTTP ${res.status}: ${text.slice(0, 200)}`,
        );
      }
      return {
        status: res.status,
        // Netcraft v3 returns { uuid: "...", state: "..." } on success
        netcraftUuid:
          typeof parsed.uuid === "string" ? parsed.uuid : null,
        state: typeof parsed.state === "string" ? parsed.state : null,
        rawResponse: parsed,
      };
    });

    await step.run("persist-submission", async () => {
      const sb = createServiceClient();
      if (!sb) return;
      // Atomic JSONB merge via v147 RPC — prevents lost-update races with
      // clone-watch-notify-brand (which can run concurrently on the same
      // alert from the shared shopfront/clone.triaged.v1 event).
      await sb.rpc("merge_clone_alert_submission", {
        p_alert_id: data.alertId,
        p_key: "netcraft",
        p_value: {
          uuid: submission.netcraftUuid,
          state: submission.state,
          submitted_at: new Date().toISOString(),
        },
        p_set_triage_status: "tp_actioned",
      });
    });

    await step.run("log-cost", async () => {
      logCost({
        feature: "shopfront_clone_submit_netcraft",
        provider: "netcraft",
        operation: "report_submit",
        units: 1,
        // Netcraft ad-hoc submission is free; the constant is here as a
        // placeholder so the brake + dashboard still reflect intent.
        unitCostUsd: 0,
        metadata: {
          alert_id: data.alertId,
          brand: data.brand,
          candidate_domain: data.candidateDomain,
          netcraft_uuid: submission.netcraftUuid,
          signal_type: data.signalType,
        },
      });
    });

    logger.info("clone-watch netcraft: submission complete", {
      alertId: data.alertId,
      netcraftUuid: submission.netcraftUuid,
    });

    return {
      ok: true,
      alertId: data.alertId,
      netcraftUuid: submission.netcraftUuid,
    };
  }),
);

export function buildSubmissionReason(data: {
  brand: string;
  candidateDomain: string;
  signalType: string;
  score: number;
}): string {
  return [
    `Possible clone of ${data.brand}.`,
    `Detected via daily NRD lexical sweep (Ask Arthur clone-watch).`,
    `Signal: ${data.signalType} match, score ${data.score.toFixed(2)}.`,
    `Surfaced under askarthur.au's Australian brand watchlist.`,
  ].join(" ");
}

// Re-exported for the route layer / tests / future logging consumers.
export const NETCRAFT_REPORT_ENDPOINT_URL = NETCRAFT_REPORT_ENDPOINT;
