import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { CLONE_WATCH_SCAN_REQUESTED_EVENT } from "@askarthur/scam-engine/inngest/events";

const BodySchema = z.object({
  alertId: z.number().int().positive(),
});

// Soft rate-limit on operator-triggered manual scans — protects the urlscan
// free-tier daily quota (100/day) from accidental button-mashing.
// Counts cost_telemetry rows for the admin-triggered operation in the last
// hour; rejects if > MAX. Per-feature (not per-user) so it caps the whole
// operator team rather than allowing N admins × N scans.
// Closes ultrareview F20.
const MAX_ADMIN_SCANS_PER_HOUR = 20;

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

  // Soft rate-limit on admin-triggered scans (ultrareview F20).
  //
  // This counts cost_telemetry rows under feature='shopfront_clone_urlscan'.
  // Until scan-one started writing one row per operator scan, the only rows here
  // were the batch lanes' ~13/day, so no rolling hour could reach 20 and this
  // cap could not fire however hard the button was clicked.
  const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count: recentScanCount, error: recentScanErr } = await sb
    .from("cost_telemetry")
    .select("id", { head: true, count: "exact" })
    .eq("feature", "shopfront_clone_urlscan")
    .gte("created_at", oneHourAgo);
  // A failed head-count returns count:null AND error:null (204, no body to
  // parse), so `?? 0` silently reads as "zero scans this hour" and opens the
  // gate. A rate limit that fails open is not a rate limit — treat an
  // unreadable count as the cap being reached.
  if (recentScanErr || recentScanCount === null) {
    logger.warn("admin scan: rate-limit count unreadable, failing closed", {
      error: recentScanErr?.message ?? null,
    });
    return NextResponse.json(
      {
        error: "rate_limit_unavailable",
        details:
          "Could not read the recent-scan count, so the hourly cap cannot be enforced. Try again shortly.",
      },
      { status: 503 },
    );
  }
  if (recentScanCount >= MAX_ADMIN_SCANS_PER_HOUR) {
    logger.warn("admin scan: rate-limited", {
      recentScanCount,
      max: MAX_ADMIN_SCANS_PER_HOUR,
    });
    return NextResponse.json(
      {
        error: "rate_limited",
        details: `Soft cap of ${MAX_ADMIN_SCANS_PER_HOUR} clone-watch scans per hour reached. Wait for the next cycle to preserve urlscan's daily quota.`,
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
