import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { readNumberEnv } from "@/lib/env-coerce";
import { logger } from "@askarthur/utils/logger";
import { alertAndRecord, recordNoAlertNeeded } from "@/lib/alerting/deliveryLog";
import { axiomQuery } from "@/lib/axiom-query";
import { axiomInfoSamplePct } from "@askarthur/utils/axiom-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every 15 min (vercel.json: "*\/15 * * * *"). The "only-page-on-something-
 * really-bad" companion to the Axiom dashboard: Axiom is the store + the place
 * you go to look, this cron is the single thing that actively pings Telegram.
 *
 * It polls the `ask-arthur` Axiom dataset for the last LOOKBACK_MINUTES and
 * pages the admin Telegram chat ONLY when a hard threshold trips:
 *   1. Inngest fn.error spike — total >= ERROR_THRESHOLD, OR any single fn
 *      failing >= PER_FN_ERROR_THRESHOLD (a specific durable job is broken).
 *   2. Runaway fn.start volume — >= RUNAWAY_THRESHOLD (the signal behind the
 *      2026-05-27..29 step-run burst that blew the Inngest Hobby cap).
 *      NOTE: fn.start is INFO level and therefore SAMPLED (~10% in prod). The
 *      count is scaled back to an estimated population before comparison — see
 *      the sampling-correction block below. Signals 1 and 3 are error level and
 *      unsampled, so they are compared raw.
 *   3. HTTP 5xx spike — >= HTTP5XX_THRESHOLD server errors (middleware logs
 *      5xx at ERROR level so they're never sampled away — see middleware.ts).
 *
 * Thresholds are deliberately high so this stays quiet in normal operation.
 * Like pg-stuck-query-watchdog it re-pages each run while a condition holds —
 * during a real incident you want the ongoing signal, and the thresholds make
 * false pages rare.
 *
 * No-ops (returns {skipped}) when AXIOM_QUERY_TOKEN is unset, so it's inert
 * until the query token is added to Vercel prod. Expected to complete in <5s;
 * well under the pg-watchdog 10-min page threshold.
 */
const LOOKBACK_MINUTES = 20; // slight overlap with the 15-min cadence (no gaps)
const DATASET = process.env.NEXT_PUBLIC_AXIOM_DATASET || "ask-arthur";

export async function GET(req: Request) {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  if (!process.env.AXIOM_QUERY_TOKEN) {
    return NextResponse.json({
      skipped: true,
      reason: "AXIOM_QUERY_TOKEN not configured",
    });
  }

  const errorThreshold = readNumberEnv("AXIOM_FLEET_ERROR_THRESHOLD", 5).value;
  const perFnThreshold = readNumberEnv("AXIOM_FLEET_PER_FN_ERROR_THRESHOLD", 3).value;
  const runawayThreshold = readNumberEnv("AXIOM_FLEET_RUNAWAY_THRESHOLD", 300).value;
  const http5xxThreshold = readNumberEnv("AXIOM_FLEET_5XX_THRESHOLD", 10).value;

  const end = new Date();
  const start = new Date(end.getTime() - LOOKBACK_MINUTES * 60_000);
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  // One query buckets the three signals; a second only runs if there are
  // inngest errors, to attribute them per-fn for the alert body.
  const bucketApl = `['${DATASET}'] | where (source == 'inngest' and (message == 'fn.error' or message == 'fn.start')) or (source == 'middleware' and level == 'error') | extend cat = case(message == 'fn.error', 'inngest_error', message == 'fn.start', 'inngest_start', 'http_5xx') | summarize n = count() by cat`;

  const buckets = await axiomQuery(bucketApl, startISO, endISO);
  if (buckets === null) {
    logger.warn("axiom-fleet-watch: query failed, skipping this run");
    return NextResponse.json({ checked: false, reason: "axiom query failed" });
  }

  const count = (cat: string): number => {
    const row = buckets.find((r) => r.cat === cat);
    return typeof row?.n === "number" ? row.n : Number(row?.n ?? 0);
  };
  const inngestErrors = count("inngest_error");
  const inngestStartsSampled = count("inngest_start");
  const http5xx = count("http_5xx");

  // SAMPLING CORRECTION (2026-07-30) — the reason this detector could not fire.
  //
  // `fn.start` is emitted with `log.info` (with-axiom-logging.ts:91), and
  // getLogger drops info/debug for ~90% of requests in production: sampling is
  // per-request, deterministic on a hash of requestId, default 10%. `fn.error`
  // and middleware 5xx use log.error, which bypasses sampling entirely — so of
  // the three signals here, ONLY the start count is a sample.
  //
  // It was previously compared raw against a threshold of 300 "fn.start in 20
  // minutes", a figure an operator naturally reads as real invocations. At 10%
  // retention that needed ~3,000 actual starts to trip — an order of magnitude
  // past the 2026-05-27..29 step-run burst this detector was written for, which
  // is why it has never paged. Verified live 2026-07-30: the cron returned
  // inngestStarts 0 for a window in which Vercel logged 22 /api/inngest
  // invocations.
  //
  // Scale the sample back to an estimated population so the threshold keeps
  // meaning what it says. Both numbers are reported: the estimate is what the
  // alert compares, the raw sample is what Axiom actually held.
  const samplePct = axiomInfoSamplePct();
  const sampleScale = samplePct > 0 ? 100 / samplePct : 1;
  const inngestStarts = Math.round(inngestStartsSampled * sampleScale);

  // Per-fn error attribution (only when there are errors).
  let topFns: Array<{ fn: string; n: number }> = [];
  if (inngestErrors > 0) {
    const byFnApl = `['${DATASET}'] | where source == 'inngest' and message == 'fn.error' | summarize n = count() by ['fields.fn'] | sort by n desc | limit 10`;
    const rows = await axiomQuery(byFnApl, startISO, endISO);
    topFns = (rows ?? []).map((r) => ({
      fn: String(r["fields.fn"] ?? "unknown"),
      n: Number(r.n ?? 0),
    }));
  }
  const worstFn = topFns[0];

  const reasons: string[] = [];
  if (inngestErrors >= errorThreshold) {
    reasons.push(`Inngest errors: <b>${inngestErrors}</b> (≥ ${errorThreshold})`);
  } else if (worstFn && worstFn.n >= perFnThreshold) {
    reasons.push(
      `<b>${worstFn.fn}</b> failing repeatedly: ${worstFn.n}× (≥ ${perFnThreshold})`,
    );
  }
  if (inngestStarts >= runawayThreshold) {
    reasons.push(
      `Runaway Inngest volume: ~<b>${inngestStarts}</b> fn.start in ${LOOKBACK_MINUTES}m ` +
        `(≥ ${runawayThreshold}; estimated from ${inngestStartsSampled} sampled at ${samplePct}%)`,
    );
  }
  if (http5xx >= http5xxThreshold) {
    reasons.push(`HTTP 5xx spike: <b>${http5xx}</b> (≥ ${http5xxThreshold})`);
  }

  const summary = {
    checked: true,
    windowMinutes: LOOKBACK_MINUTES,
    inngestErrors,
    // Estimated population; `inngestStartsSampled` is what Axiom actually held.
    // Both are surfaced so a reader can tell the correction is being applied
    // rather than wondering why the number looks inflated.
    inngestStarts,
    inngestStartsSampled,
    infoSamplePct: samplePct,
    http5xx,
    topFns,
    tripped: reasons.length > 0,
  };

  if (reasons.length === 0) {
    await recordNoAlertNeeded("axiom-fleet-watch", summary as Record<string, unknown>);
    return NextResponse.json(summary);
  }

  const fnLines =
    topFns.length > 0
      ? "\n" + topFns.map((f) => `  • ${f.fn} ×${f.n}`).join("\n")
      : "";
  const text =
    `🚨 <b>Axiom fleet watch</b> — last ${LOOKBACK_MINUTES}m\n\n` +
    reasons.map((r) => `• ${r}`).join("\n") +
    fnLines +
    `\n\nInspect: Axiom → <code>${DATASET}</code> dataset (Query: ` +
    `<code>['${DATASET}'] | where source=='inngest' and message=='fn.error'</code>)`;

  await alertAndRecord({
    alerter: "axiom-fleet-watch",
    text,
    metadata: summary as Record<string, unknown>,
  });
  logger.warn("axiom-fleet-watch paged admin", summary);

  return NextResponse.json({ ...summary, paged: true });
}
