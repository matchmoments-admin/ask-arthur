import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { CLONE_WATCH_SCAN_REQUESTED_EVENT } from "@askarthur/scam-engine/inngest/events";
import {
  URLSCAN_SPENDERS,
  decideUnlistedSpend,
  readUnlistedLedger,
} from "@/lib/clone-watch/urlscan-budget";

const BodySchema = z.object({
  alertId: z.number().int().positive(),
});

// Operator scans spend urlscan's key-wide UNLISTED quota (60/min, 100/hour,
// 1,000/day), the same quota the submit, recheck and enrichment lanes spend.
// Their own caps (20/hour, 100/day, in UNITS) and the key-wide headroom are
// declared once in lib/clone-watch/urlscan-budget.ts. Per-feature, not
// per-user, so it caps the whole operator team. Closes ultrareview F20.
const OWN_CAP = URLSCAN_SPENDERS.scanOne.ownCap!;

export const dynamic = "force-dynamic";

/**
 * Admin "Scan now" — emit a shopfront/clone.scan-requested.v1 event for the
 * given alert. Used to:
 *  - Smoke-test the urlscan path before flipping FF on broadly
 *  - Manually re-scan a row when the operator wants a fresh result
 *
 * Gated on FF_SHOPFRONT_CLONE_URLSCAN (so the downstream consumer doesn't
 * silently skip), requireAdmin (HMAC cookie or Supabase auth admin).
 */
export async function POST(req: Request) {
  await requireAdmin();

  if (!featureFlags.shopfrontCloneUrlscan) {
    return NextResponse.json(
      { error: "urlscan_disabled" },
      { status: 503 },
    );
  }

  let parsed;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid_body",
        details: err instanceof Error ? err.message : "validation failed",
      },
      { status: 400 },
    );
  }

  const sb = createServiceClient();
  if (!sb) {
    return NextResponse.json(
      { error: "supabase_unavailable" },
      { status: 503 },
    );
  }

  // Budget check (ultrareview F20, reworked for the urlscan budget Module).
  //
  // It counts UNITS, not rows. The old cap counted cost_telemetry ROWS under
  // feature='shopfront_clone_urlscan', and a recheck run's 90 submits are ONE
  // recheck_submit row, while retrieve_batch rows (another quota) counted
  // too. It also ignored the other lanes' spend, so a click during a 90-scan
  // recheck batch passed. Now: the scan-one units in the trailing hour/day
  // against OWN_CAP, plus every unlisted spender's units and any scheduled
  // batch in flight or due within the hour against 100/hour and 1,000/day.
  //
  // An unreadable ledger returns null, never an empty list, and fails CLOSED.
  // A failed head-count used to read as "zero scans".
  const nowMs = Date.now();
  const decision = decideUnlistedSpend(
    "scanOne",
    URLSCAN_SPENDERS.scanOne.perRun,
    await readUnlistedLedger(sb, nowMs),
    nowMs,
  );
  if (!decision.ok && decision.reason === "ledger_unreadable") {
    logger.warn("admin scan: urlscan ledger unreadable, failing closed", {});
    return NextResponse.json(
      {
        error: "rate_limit_unavailable",
        details:
          "Could not read recent urlscan spend, so the hourly cap cannot be enforced. Try again shortly.",
      },
      { status: 503 },
    );
  }
  if (!decision.ok) {
    logger.warn("admin scan: refused by urlscan budget", { ...decision });
    return NextResponse.json(
      {
        error: "rate_limited",
        reason: decision.reason,
        details:
          decision.reason === "own_hourly_cap" || decision.reason === "own_daily_cap"
            ? `Operator scan cap reached (${OWN_CAP.perHour}/hour, ${OWN_CAP.perDay}/day).`
            : `urlscan's unlisted quota has no headroom right now (used ${decision.usedHour}/h + ${decision.reservedHour} reserved for scheduled lanes; ${decision.usedDay}/day). Try again later.`,
      },
      { status: 429 },
    );
  }

  const { data: alert, error } = await sb
    .from("shopfront_clone_alerts")
    .select("id, candidate_url, candidate_domain")
    .eq("id", parsed.alertId)
    .maybeSingle();

  if (error) {
    logger.error("admin scan: load failed", {
      alertId: parsed.alertId,
      error: error.message,
    });
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
  if (!alert) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    await inngest.send({
      name: CLONE_WATCH_SCAN_REQUESTED_EVENT,
      // Unique id per manual trigger so the per-fn idempotency doesn't
      // collide with the initial scan
      id: `clone-watch-urlscan-admin:${alert.id}:${Date.now()}`,
      data: {
        alertId: alert.id,
        candidateUrl: alert.candidate_url,
        candidateDomain: alert.candidate_domain,
        reason: "rescan" as const,
      },
    });
  } catch (err) {
    logger.error("admin scan: event emit failed", {
      alertId: alert.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "event_emit_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    alertId: alert.id,
    candidateDomain: alert.candidate_domain,
    enqueued: true,
  });
}
