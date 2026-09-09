import "server-only";

// Vonage CAMARA-landed backfill.
//
// Fires when Vonage's CAMARA SIM Swap / Device Swap capabilities flip
// from "pending" to "live" for the user's account (Aduna + Telstra
// approval). The day that happens, every active monitor's stored
// footprint is missing pillar 4 ("SIM swap / carrier drift") because
// the orchestrator gracefully degraded it. This function re-runs the
// orchestrator across all active monitors so subsequent dashboard
// loads + delta detections see the new pillar without waiting for the
// natural refresh cadence.
//
// Trigger: event `phone-footprint/vonage.backfill.requested.v1`. Fired
// either from the admin panel ("Vonage went live, backfill now") or
// programmatically by a future health-check that detects coverage
// flipping to "live" for the first time.
//
// Idempotent: each per-monitor sub-event is keyed on
// `backfill:<requestId>:monitor:<id>` so retries don't double-orchestrate.
// The function pages through monitors in batches so a 100k-monitor
// fleet doesn't OOM the runtime.

import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import {
  buildPhoneFootprint,
  type Footprint,
} from "@askarthur/scam-engine/phone-footprint";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export const VONAGE_BACKFILL_REQUESTED_EVENT =
  "phone-footprint/vonage.backfill.requested.v1" as const;
export const VONAGE_BACKFILL_MONITOR_EVENT =
  "phone-footprint/vonage.backfill.monitor.v1" as const;

const PAGE_SIZE = 100;

/**
 * Pages per run, and therefore the run's boundary count.
 *
 * LOWERED 1000 -> 20 in #1139. The old value was a runaway guard ("so a
 * runaway loop dies safely"), never a data bound — but the loop spends TWO
 * step boundaries per page, so 1000 pages is 2,000 boundaries, and ADR-0019's
 * floor (boundaries x 30s queue wait) makes an honest finish timeout for that
 * about sixteen hours. A sixteen-hour circuit breaker is not one, so the
 * ceiling had to become a real bound before a real budget could exist.
 *
 * 20 pages x PAGE_SIZE (100) = 2,000 monitors, against a feature with ZERO
 * lifetime usage (NORTH_STAR.md — Phone Footprint is mothballed). The loop
 * already exits on the first short page, so a realistic run is one boundary
 * pair. Exceeding the cap is now reported rather than silent.
 *
 * RE-DERIVE BOTH THIS AND timeouts.finish before un-mothballing: if the
 * monitor table is ever larger than 2,000 the pager needs a resumable cursor,
 * not a bigger number — it emits one event per monitor, so its fan-out is the
 * thing to size first.
 */
const MAX_PAGES = 20;

interface MonitorRow {
  id: number;
  user_id: string | null;
  org_id: string | null;
  msisdn_e164: string;
  tier: "basic" | "full";
}

// =============================================================================
// Stage 1 — pager
// =============================================================================

// inngest-finish-budget: 43 boundaries — this FILE holds two functions and the
// floor test reads the first finish timeout it finds, so the count covers both:
// the pager's 2 interpolated steps x MAX_PAGES (20) = 40, plus the monitor's 3
// static steps. 43 x 30s queue wait = 1290s; no inline wall-clock budget; 60s
// slack = 1350s. Declared 24m (1440s) on the pager, clear of the 22.5m floor.
//
// The monitor's own 5m is therefore NOT covered by the floor check — the test
// is per file, not per function. Stated so the gap is known rather than
// assumed closed.
export const phoneFootprintVonageBackfillPager = inngest.createFunction(
  {
    id: "phone-footprint-vonage-backfill-pager",
    name: "Phone Footprint: Vonage backfill — page monitors",
    idempotency: "event.data.requestId",
    retries: 2,
    // ADR-0019's circuit breaker, absent until #1139. See the derivation
    // above; it depends on MAX_PAGES, so lowering that number without
    // revisiting this one is safe and raising it is not.
    timeouts: { finish: "24m" },
    concurrency: { limit: 1 },
  },
  { event: VONAGE_BACKFILL_REQUESTED_EVENT },
  withAxiomLogging(
    { fnId: "phone-footprint-vonage-backfill-pager" },
    async ({ event, step }) => {
      const { requestId } = event.data as { requestId: string };
      if (!requestId) {
        return { error: "missing_request_id" };
      }

      let cursor: number | null = null;
      let totalEmitted = 0;
      let pageCount = 0;

      while (pageCount < MAX_PAGES) {
        pageCount++;
        const page = await step.run(`page-${pageCount}`, async () =>
          loadPage(cursor),
        );
        if (page.length === 0) break;

        // Emit one event per monitor — Inngest dedups via idempotency on
        // each consumer, and a single failing monitor doesn't block the
        // others.
        await step.run(`emit-${pageCount}`, async () => {
          await Promise.all(
            page.map((m) =>
              inngest.send({
                name: VONAGE_BACKFILL_MONITOR_EVENT,
                data: { monitorId: m.id, requestId },
              }),
            ),
          );
        });

        totalEmitted += page.length;
        cursor = page[page.length - 1].id;
        if (page.length < PAGE_SIZE) break;
      }

      // Hitting the page cap means monitors were left un-emitted. Loud, because
      // nothing else would say so: the loop simply stops and the run returns a
      // success-shaped result. Not self-healing either — this function is fired
      // by an operator event, so the remainder is not picked up by anything.
      const truncated = pageCount >= MAX_PAGES;
      if (truncated) {
        logger.warn(
          "vonage-backfill pager: page cap reached, monitors skipped",
          {
            requestId,
            pageCount,
            maxPages: MAX_PAGES,
            totalEmitted,
            lastCursor: cursor,
          },
        );
      }

      return { totalEmitted, pageCount, truncated };
    },
  ),
);

async function loadPage(cursor: number | null): Promise<MonitorRow[]> {
  const supa = createServiceClient();
  if (!supa) return [];
  let query = supa
    .from("phone_footprint_monitors")
    .select("id, user_id, org_id, msisdn_e164, tier")
    .eq("status", "active")
    .is("soft_deleted_at", null)
    .order("id", { ascending: true })
    .limit(PAGE_SIZE);
  if (cursor !== null) query = query.gt("id", cursor);
  const { data, error } = await query;
  if (error) {
    logger.warn("vonage backfill page failed", {
      error: String(error.message),
    });
    return [];
  }
  return (data ?? []) as MonitorRow[];
}

// =============================================================================
// Stage 2 — per-monitor backfill
// =============================================================================

export const phoneFootprintVonageBackfillMonitor = inngest.createFunction(
  {
    id: "phone-footprint-vonage-backfill-monitor",
    name: "Phone Footprint: Vonage backfill — one monitor",
    // Per-monitor idempotency keyed on (requestId, monitorId) so a single
    // backfill request can't re-orchestrate the same monitor twice even
    // if Inngest retries.
    idempotency: "event.data.requestId + ':' + event.data.monitorId",
    retries: 1,
    // ADR-0019's circuit breaker, absent until #1139. 3 static step.run sites:
    // 3 x 30s queue wait + 60s slack = 150s. `orchestrate` calls
    // buildPhoneFootprint, which fans out provider lookups with their own
    // timeouts. Declared 5m (300s). NOTE this one is not covered by the floor
    // check — see the file-level derivation above the pager.
    timeouts: { finish: "5m" },
    // Capped at 3 (PR-B rebalance, down from 5): reserves ≥2 of Hobby's 5
    // concurrent slots for the latency-sensitive analyze fan-out.
    concurrency: { limit: 3 },
  },
  { event: VONAGE_BACKFILL_MONITOR_EVENT },
  withAxiomLogging(
    { fnId: "phone-footprint-vonage-backfill-monitor" },
    async ({ event, step }) => {
      const { monitorId, requestId } = event.data as {
        monitorId: number;
        requestId: string;
      };

      const monitor = await step.run("load-monitor", () =>
        loadMonitor(monitorId),
      );
      if (!monitor) return { skipped: true, reason: "monitor_not_found" };

      // Re-run the orchestrator at the monitor's current tier. The
      // user-facing `requestId` is included so the snapshot row's
      // request_id traces back to this specific backfill batch — useful
      // for forensics if the backfill produces unexpected results.
      const footprint = await step.run("orchestrate", () =>
        buildPhoneFootprint(monitor.msisdn_e164, {
          tier: monitor.tier,
          userId: monitor.user_id ?? undefined,
          orgId: monitor.org_id ?? undefined,
          ownershipProven: true, // monitor existence implies prior OTP
          requestId: `vonage-backfill-${requestId}-monitor-${monitorId}`,
        }),
      );

      const newId = await step.run("persist", () =>
        persistAndLink(footprint, monitor),
      );
      if (!newId) {
        throw new Error("persist_failed"); // Inngest retries via retries:1
      }

      return {
        ok: true,
        monitorId,
        newFootprintId: newId,
        vonageCoverage: footprint.coverage.vonage,
      };
    },
  ),
);

async function loadMonitor(id: number): Promise<MonitorRow | null> {
  const supa = createServiceClient();
  if (!supa) return null;
  const { data, error } = await supa
    .from("phone_footprint_monitors")
    .select("id, user_id, org_id, msisdn_e164, tier, status, soft_deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  if (data.status !== "active" || data.soft_deleted_at) return null;
  return {
    id: data.id as number,
    user_id: (data.user_id as string | null) ?? null,
    org_id: (data.org_id as string | null) ?? null,
    msisdn_e164: data.msisdn_e164 as string,
    tier: data.tier as "basic" | "full",
  };
}

async function persistAndLink(
  fp: Footprint,
  monitor: MonitorRow,
): Promise<number | null> {
  const supa = createServiceClient();
  if (!supa) return null;

  const { data: insRow, error } = await supa
    .from("phone_footprints")
    .insert({
      user_id: monitor.user_id,
      org_id: monitor.org_id,
      msisdn_e164: fp.msisdn_e164,
      msisdn_hash: fp.msisdn_hash,
      tier_generated:
        fp.tier === "teaser"
          ? "teaser"
          : fp.tier === "basic"
            ? "basic"
            : "full",
      composite_score: fp.composite_score,
      band: fp.band,
      pillar_scores: fp.pillars,
      coverage: fp.coverage,
      providers_used: fp.providers_used,
      explanation: fp.explanation,
      idempotency_key: fp.request_id ?? null,
      request_id: fp.request_id ?? null,
      generated_at: fp.generated_at,
      expires_at: fp.expires_at,
    })
    .select("id")
    .single();
  if (error || !insRow) {
    logger.warn("vonage backfill persist failed", {
      error: String(error?.message),
      monitorId: monitor.id,
    });
    return null;
  }

  await supa
    .from("phone_footprint_monitors")
    .update({
      last_footprint_id: insRow.id,
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", monitor.id);

  return insRow.id;
}
