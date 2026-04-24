import "server-only";

// Phone Footprint refresh — two-stage Inngest pipeline.
//
// Stage 1 (cron): phone-footprint-refresh-claimer
//   Hourly. Claims up to N due rows from phone_footprint_refresh_queue
//   where scheduled_for < now() AND not already claimed/completed.
//   Emits one phone-footprint/refresh.monitor.v1 event per claimed row.
//   Stays small + fast — no orchestrator work in the cron itself, only
//   queue claiming. This separates "what's due?" from "actually refresh"
//   so concurrency and retries are independent.
//
// Stage 2 (event): phone-footprint-refresh-monitor
//   One per monitor. Loads the monitor + its previous footprint, runs
//   the orchestrator at the monitor's tier, computes the delta vs prev,
//   inserts a phone_footprints snapshot, writes alert rows for each
//   delta that crosses the monitor's alert_threshold, dispatches via
//   email + webhook (when configured), then re-queues the next refresh
//   based on the monitor's cadence.
//
// Lives in apps/web because it spans R2 (no, we don't render PDF here),
// Resend (alert email), and the engine. Same dependency rule as the
// PDF function — apps/web depends on scam-engine, not the other way.

import { inngest } from "@askarthur/scam-engine/inngest/client";
import {
  buildPhoneFootprint,
  computeDelta,
  type Footprint,
  type FootprintTier,
} from "@askarthur/scam-engine/phone-footprint";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { dispatchAlert } from "@/lib/phone-footprint/alert-dispatch";

export const REFRESH_MONITOR_EVENT = "phone-footprint/refresh.monitor.v1" as const;

const CLAIM_BATCH_SIZE = 50;
const CLAIMER_CRON = "TZ=Australia/Sydney 0 * * * *"; // hourly on the hour

interface MonitorRow {
  id: number;
  user_id: string | null;
  org_id: string | null;
  msisdn_e164: string;
  tier: "basic" | "full";
  refresh_cadence: "daily" | "weekly" | "monthly";
  alert_threshold: number;
  last_footprint_id: number | null;
  next_refresh_at: string;
  status: string;
  soft_deleted_at: string | null;
}

// =============================================================================
// Stage 1 — claimer cron
// =============================================================================

export const phoneFootprintRefreshClaimer = inngest.createFunction(
  {
    id: "phone-footprint-refresh-claimer",
    name: "Phone Footprint: claim due refreshes",
    concurrency: { limit: 1 }, // one claimer at a time
    retries: 1,
  },
  { cron: CLAIMER_CRON },
  async ({ step }) => {
    const claimed = await step.run("claim-due", async () => {
      const supa = createServiceClient();
      if (!supa) return [];

      // Two-step claim: SELECT due rows, then UPDATE to mark them claimed.
      // No FOR UPDATE SKIP LOCKED via PostgREST so we tolerate small
      // races by using id-list update; concurrency:1 above means only
      // one claimer runs at a time.
      const { data: due } = await supa
        .from("phone_footprint_refresh_queue")
        .select("id, monitor_id")
        .lt("scheduled_for", new Date().toISOString())
        .is("claimed_at", null)
        .is("completed_at", null)
        .order("scheduled_for", { ascending: true })
        .limit(CLAIM_BATCH_SIZE);

      if (!due || due.length === 0) return [];

      const ids = due.map((d) => d.id);
      const claimedAt = new Date().toISOString();
      const { error } = await supa
        .from("phone_footprint_refresh_queue")
        .update({ claimed_at: claimedAt, claimed_by: "inngest" })
        .in("id", ids);
      if (error) {
        logger.warn("refresh-claimer claim update failed", { error: String(error.message) });
        return [];
      }
      return due;
    });

    if (claimed.length === 0) return { skipped: true, reason: "no due monitors" };

    // Emit one event per claim — Inngest fan-out + retries are per-event,
    // so a single failing monitor doesn't block the others.
    await step.run("emit-events", async () => {
      await Promise.all(
        claimed.map((c) =>
          inngest.send({
            name: REFRESH_MONITOR_EVENT,
            data: { monitorId: c.monitor_id, queueId: c.id },
          }),
        ),
      );
    });

    return { claimed: claimed.length };
  },
);

// =============================================================================
// Stage 2 — per-monitor refresh
// =============================================================================

export const phoneFootprintRefreshMonitor = inngest.createFunction(
  {
    id: "phone-footprint-refresh-monitor",
    name: "Phone Footprint: refresh one monitor",
    idempotency: "event.data.queueId", // one refresh per claimed queue row
    retries: 2,
    concurrency: { limit: 10 }, // cap concurrent provider fan-outs
  },
  { event: REFRESH_MONITOR_EVENT },
  async ({ event, step }) => {
    const { monitorId, queueId } = event.data as {
      monitorId: number;
      queueId: number;
    };

    const monitor = await step.run("load-monitor", () => loadMonitor(monitorId));
    if (!monitor) {
      await markCompleted(queueId, "monitor_not_found");
      return { skipped: true, reason: "monitor_not_found" };
    }
    if (monitor.soft_deleted_at || monitor.status !== "active") {
      await markCompleted(queueId, "monitor_inactive");
      return { skipped: true, reason: "monitor_inactive", status: monitor.status };
    }

    const prev = await step.run("load-prev", () =>
      monitor.last_footprint_id ? loadFootprint(monitor.last_footprint_id) : Promise.resolve(null),
    );

    const fresh = await step.run("orchestrate", () =>
      buildPhoneFootprint(monitor.msisdn_e164, {
        tier: monitor.tier as FootprintTier,
        userId: monitor.user_id ?? undefined,
        orgId: monitor.org_id ?? undefined,
        ownershipProven: true, // monitor existence implies prior OTP
        requestId: `refresh-${monitorId}-${Date.now()}`,
        // Threading prev through enables the orchestrator's carrier-drift
        // fallback for pillar 4 in countries without Vonage CAMARA
        // (currently AU + most of the world). Cheap weak-signal detection
        // from data Twilio Lookup already returns — no extra API spend.
        previousFootprint: prev,
      }),
    );

    // Persist new snapshot, link to monitor.
    const newId = await step.run("persist", () => persistAndLink(fresh, monitor));
    if (!newId) {
      // Persist failure isn't fatal — try again next cycle. Mark queue
      // completed with an error note so the cron doesn't re-emit on
      // every tick.
      await markCompleted(queueId, "persist_failed");
      throw new Error("persist_failed"); // Inngest retries via retries:2
    }

    // Compute deltas + persist alert rows + dispatch.
    const dispatched = await step.run("alerts", async () => {
      if (!prev) return { count: 0 };
      const deltas = computeDelta(prev, fresh, {
        scoreThreshold: monitor.alert_threshold,
      });
      if (deltas.length === 0) return { count: 0 };

      const supa = createServiceClient();
      if (!supa) return { count: 0, error: "supabase_unavailable" };

      let count = 0;
      for (const delta of deltas) {
        const idemKey = `monitor:${monitorId}:fp:${newId}:${delta.type}`;
        const { data: alertRow, error } = await supa
          .from("phone_footprint_alerts")
          .insert({
            monitor_id: monitorId,
            prev_footprint_id: prev ? (await getFootprintIdByRef(prev)) : null,
            next_footprint_id: newId,
            alert_type: delta.type,
            severity: delta.severity,
            details: delta.detail,
            idempotency_key: idemKey,
          })
          .select("id")
          .maybeSingle();

        if (error) {
          if (error.code === "23505") {
            // Duplicate — Inngest retried. Skip silently.
            continue;
          }
          logger.warn("alert insert failed", { error: String(error.message), idemKey });
          continue;
        }

        if (alertRow) {
          await dispatchAlert({
            alertId: alertRow.id,
            monitor,
            footprint: fresh,
            delta,
          });
          count++;
        }
      }
      return { count };
    });

    // Re-queue next refresh based on cadence.
    await step.run("requeue", () => requeue(monitor));
    await markCompleted(queueId, "ok");

    return {
      ok: true,
      monitorId,
      newFootprintId: newId,
      alertsDispatched: dispatched.count,
    };
  },
);

// ---------------------------------------------------------------------------

async function loadMonitor(id: number): Promise<MonitorRow | null> {
  const supa = createServiceClient();
  if (!supa) return null;
  const { data, error } = await supa
    .from("phone_footprint_monitors")
    .select(
      "id, user_id, org_id, msisdn_e164, tier, refresh_cadence, alert_threshold, last_footprint_id, next_refresh_at, status, soft_deleted_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as MonitorRow;
}

async function loadFootprint(id: number): Promise<Footprint | null> {
  const supa = createServiceClient();
  if (!supa) return null;
  const { data } = await supa
    .from("phone_footprints")
    .select(
      "msisdn_e164, msisdn_hash, tier_generated, composite_score, band, pillar_scores, coverage, providers_used, explanation, generated_at, expires_at, request_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    msisdn_e164: data.msisdn_e164 as string,
    msisdn_hash: data.msisdn_hash as string,
    tier: data.tier_generated as Footprint["tier"],
    composite_score: data.composite_score as number,
    band: data.band as Footprint["band"],
    pillars: data.pillar_scores as Footprint["pillars"],
    coverage: data.coverage as Footprint["coverage"],
    providers_used: data.providers_used as string[],
    explanation: data.explanation as string | null,
    generated_at: data.generated_at as string,
    expires_at: data.expires_at as string,
    request_id: data.request_id as string | undefined,
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
      tier_generated: fp.tier === "teaser" ? "teaser" : fp.tier === "basic" ? "basic" : "full",
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
    logger.warn("refresh persist failed", { error: String(error?.message) });
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

// Look up the previous footprint's PK from a Footprint object — needed
// because computeDelta gives us the prev Footprint shape but the alert
// row needs the BIGINT id. Cheap lookup by msisdn_hash + generated_at.
async function getFootprintIdByRef(fp: Footprint): Promise<number | null> {
  const supa = createServiceClient();
  if (!supa) return null;
  const { data } = await supa
    .from("phone_footprints")
    .select("id")
    .eq("msisdn_hash", fp.msisdn_hash)
    .eq("generated_at", fp.generated_at)
    .maybeSingle();
  return (data?.id as number) ?? null;
}

async function requeue(monitor: MonitorRow): Promise<void> {
  const supa = createServiceClient();
  if (!supa) return;
  const intervalMs =
    monitor.refresh_cadence === "daily"
      ? 24 * 3600 * 1000
      : monitor.refresh_cadence === "weekly"
        ? 7 * 24 * 3600 * 1000
        : 30 * 24 * 3600 * 1000;
  const next = new Date(Date.now() + intervalMs).toISOString();

  await supa
    .from("phone_footprint_monitors")
    .update({ next_refresh_at: next })
    .eq("id", monitor.id);

  await supa.from("phone_footprint_refresh_queue").insert({
    monitor_id: monitor.id,
    scheduled_for: next,
  });
}

async function markCompleted(queueId: number, _reason: string): Promise<void> {
  const supa = createServiceClient();
  if (!supa) return;
  await supa
    .from("phone_footprint_refresh_queue")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", queueId);
}
