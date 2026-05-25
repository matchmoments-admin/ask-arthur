import { NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import { readNumberEnv, type NumberEnvResult } from "@/lib/env-coerce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every 6 hours (vercel.json: "0 *\/6 * * *"), checks today's cumulative
 * AI / paid-API spend via the `today_cost_total` view. If it exceeds
 * DAILY_COST_THRESHOLD_USD (default: $2), DMs the admin Telegram chat with
 * a breakdown of the top-3 contributing features. Silent otherwise.
 *
 * Authenticated via the CRON_SECRET bearer token auto-attached by Vercel
 * Cron, matching the pattern used by the other /api/cron/* routes.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Read all 6 numeric env-var caps up front via the safe coercer. Track
  // any invalid values so we can write a single diagnostic row before any
  // brake decision uses the (defaulted) value — otherwise a typo in
  // REDDIT_INTEL_CAP_USD silently disables the brake.
  const envReads: Record<string, NumberEnvResult> = {
    DAILY_COST_THRESHOLD_USD: readNumberEnv("DAILY_COST_THRESHOLD_USD", 2),
    VULN_AU_ENRICHMENT_CAP_USD: readNumberEnv("VULN_AU_ENRICHMENT_CAP_USD", 5),
    REDDIT_INTEL_CAP_USD: readNumberEnv("REDDIT_INTEL_CAP_USD", 10),
    PHONE_FOOTPRINT_CAP_USD: readNumberEnv("PHONE_FOOTPRINT_CAP_USD", 5),
    CHARITY_CHECK_CAP_USD: readNumberEnv("CHARITY_CHECK_CAP_USD", 5),
    SHOP_SIGNAL_CAP_USD: readNumberEnv("SHOP_SIGNAL_CAP_USD", 15),
    SHOPFRONT_CLONE_OUTREACH_CAP_USD: readNumberEnv(
      "SHOPFRONT_CLONE_OUTREACH_CAP_USD",
      5,
    ),
  };
  const thresholdUsd = envReads.DAILY_COST_THRESHOLD_USD.value;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  // Surface invalid env values to cost_telemetry — health-digest aggregates
  // feature LIKE '%error%' rows into its daily admin Telegram, so this lands
  // visibly within 24h without needing a separate alerter. One row per bad
  // env var per cron firing; at 4 firings/day × 6 env vars = max 24 rows/day
  // even in the pathological all-bad-config case.
  const invalidEnvs = Object.entries(envReads).filter(([, r]) => r.invalid);
  if (invalidEnvs.length > 0) {
    for (const [name, result] of invalidEnvs) {
      logger.warn("cost-daily-check: invalid env value, falling back to default", {
        env_var: name,
        raw_value: result.rawValue,
        fallback: result.value,
      });
    }
    await supabase.from("cost_telemetry").insert(
      invalidEnvs.map(([name, result]) => ({
        feature: "cost-brake-config-error",
        provider: "diagnostic",
        operation: "parse_env",
        units: 1,
        estimated_cost_usd: 0,
        metadata: {
          env_var: name,
          raw_value: result.rawValue,
          fallback: result.value,
        },
      })),
    );
  }

  const { data: today, error: todayError } = await supabase
    .from("today_cost_total")
    .select("total_cost_usd, event_count")
    .single();

  if (todayError) {
    logger.error("cost-daily-check: query failed", { error: todayError.message });
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const costTelemetryUsd = Number(today?.total_cost_usd ?? 0);
  const eventCount = Number(today?.event_count ?? 0);

  // Vonage Phone Footprint spend lives in telco_api_usage, not cost_telemetry,
  // so query it independently and include it in the global threshold gate.
  // Without this, a runaway Vonage refresh loop ($50+/day) could escape the
  // alert/brake path entirely if cost_telemetry rows for the day stayed low.
  const todayUtc = new Date().toISOString().slice(0, 10);
  const todayStartIso = new Date(`${todayUtc}T00:00:00.000Z`).toISOString();
  const { data: vonageRows } = await supabase
    .from("telco_api_usage")
    .select("cost_usd")
    .gte("created_at", todayStartIso)
    .eq("status", "ok");
  const vonageCost = (vonageRows ?? []).reduce(
    (sum, r) => sum + Number(r.cost_usd ?? 0),
    0,
  );
  const totalCostUsd = costTelemetryUsd + vonageCost;

  if (totalCostUsd <= thresholdUsd) {
    return NextResponse.json({
      belowThreshold: true,
      totalCostUsd,
      costTelemetryUsd,
      vonageCost,
      thresholdUsd,
      eventCount,
    });
  }

  // Over threshold — fetch top 3 contributing features for context.
  const { data: topRows } = await supabase
    .from("daily_cost_summary")
    .select("feature, provider, event_count, total_cost_usd")
    .eq("day", todayUtc)
    .order("total_cost_usd", { ascending: false })
    .limit(10);

  const top = (topRows ?? []).map((r) => ({
    feature: r.feature as string,
    provider: r.provider as string,
    events: Number(r.event_count),
    cost: Number(r.total_cost_usd),
  }));

  // Phase 14 Sprint 2 PR B3: per-feature cost brake. If vuln_au_enrichment
  // exceeds the per-feature threshold, write a feature_brakes row so the
  // enrich-vulnerability Inngest function short-circuits until tomorrow.
  // The threshold is intentionally separate from DAILY_COST_THRESHOLD_USD —
  // a $5 burst on enrichment alone should pause enrichment even if total
  // spend is nowhere near the $2 Telegram threshold.
  //
  // Reddit Intel uses the same pattern: aggregate today's spend across
  // reddit-intel-classify + reddit-intel-embed + reddit-intel-name-themes
  // (excluding reddit-intel-error which is $0 diagnostic). If sum exceeds
  // REDDIT_INTEL_CAP_USD, brake the whole pipeline for 24h.
  const vulnEnrichThresholdUsd = envReads.VULN_AU_ENRICHMENT_CAP_USD.value;
  const vulnEnrichCost = top.find(
    (t) => t.feature === "vuln_au_enrichment",
  )?.cost ?? 0;

  const redditIntelThresholdUsd = envReads.REDDIT_INTEL_CAP_USD.value;
  const redditIntelCost = top
    .filter(
      (t) =>
        t.feature === "reddit-intel-classify" ||
        t.feature === "reddit-intel-embed" ||
        t.feature === "reddit-intel-name-themes",
    )
    .reduce((sum, t) => sum + t.cost, 0);

  // Phone Footprint runs Vonage NI v2 ($0.04) + CAMARA SIM Swap ($0.04) +
  // CAMARA Device Swap ($0.04) per paid-tier refresh = ~$0.12/lookup. Vonage
  // spend was already pulled from telco_api_usage above for the global gate;
  // here we add Resend dispatch emails (tracked in cost_telemetry under
  // feature='phone_footprint') for the brake calculation. Cap tighter than
  // the per-feature plan ($5/day) — at 1k DAU a runaway refresh loop could
  // rack up Vonage spend in minutes.
  const phoneFootprintThresholdUsd = envReads.PHONE_FOOTPRINT_CAP_USD.value;
  const phoneFootprintTelemetryCost =
    top.find((t) => t.feature === "phone_footprint")?.cost ?? 0;
  const phoneFootprintCost = vonageCost + phoneFootprintTelemetryCost;

  // Charity Check — v0.1 has zero marginal external cost (ACNC is a local
  // Postgres mirror, ABR is free + Redis-cached). The brake exists ahead
  // of v0.2's image OCR (Claude Vision ~$0.002–$0.01/image) so the
  // threshold is wired before the spend appears. Default $5/day matches
  // the per-feature pattern used elsewhere.
  const charityCheckThresholdUsd = envReads.CHARITY_CHECK_CAP_USD.value;
  const charityCheckCost = top.find((t) => t.feature === "charity_check")?.cost ?? 0;

  // Shop Signal — APIVoid Site Trustworthiness paid feed. Same multi-tag
  // aggregation as Reddit Intel: the headline `shop_signal` tag carries the
  // per-call cost; the `-error` / `-overage` tags are $0 diagnostics, summed
  // in for tag-drift resilience. Cap defaults to $15/day (~A$22.50) — see
  // docs/ops/shop-signal-config.md §3. Engaging this brake pauses only the
  // paid feed; the free Stage-0 detector keeps running.
  const shopSignalThresholdUsd = envReads.SHOP_SIGNAL_CAP_USD.value;
  const shopSignalCost = top
    .filter(
      (t) =>
        t.feature === "shop_signal" ||
        t.feature === "shop-signal-apivoid-error" ||
        t.feature === "shop-signal-apivoid-overage",
    )
    .reduce((sum, t) => sum + t.cost, 0);

  // Clone-watch outreach — aggregate across the 6 sub-features (Netcraft
  // submit + poll, brand notify, weekly digest, urlscan + urlscan rescan).
  // Engaging this brake pauses ALL clone-watch outreach activity for 24h;
  // the upstream Layer 0 NRD ingest (shopfront_clone_watch) keeps running.
  // urlscan + urlscan_rescan added per ultrareview F6 (PR #432).
  const shopfrontCloneOutreachThresholdUsd =
    envReads.SHOPFRONT_CLONE_OUTREACH_CAP_USD.value;
  const shopfrontCloneOutreachCost = top
    .filter(
      (t) =>
        t.feature === "shopfront_clone_submit_netcraft" ||
        t.feature === "shopfront_clone_notify_brand" ||
        t.feature === "shopfront_clone_weekly_digest" ||
        t.feature === "shopfront_clone_poll_netcraft" ||
        t.feature === "shopfront_clone_urlscan" ||
        t.feature === "shopfront_clone_urlscan_rescan",
    )
    .reduce((sum, t) => sum + t.cost, 0);

  let brakeSet = false;
  let redditBrakeSet = false;
  let phoneFootprintBrakeSet = false;
  let charityCheckBrakeSet = false;
  let shopSignalBrakeSet = false;
  let shopfrontCloneOutreachBrakeSet = false;
  if (vulnEnrichCost > vulnEnrichThresholdUsd) {
    const pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error: brakeError } = await supabase
      .from("feature_brakes")
      .upsert(
        {
          feature: "vuln_au_enrichment",
          paused_until: pausedUntil,
          reason: `Daily spend $${vulnEnrichCost.toFixed(2)} exceeded $${vulnEnrichThresholdUsd} cap`,
          set_by: "cost-daily-check",
          set_cost_usd: vulnEnrichCost,
          set_threshold_usd: vulnEnrichThresholdUsd,
          set_at: new Date().toISOString(),
        },
        { onConflict: "feature" },
      );
    if (brakeError) {
      logger.error("failed to set vuln_au_enrichment brake", {
        error: brakeError.message,
      });
    } else {
      brakeSet = true;
      logger.warn("vuln_au_enrichment brake engaged", {
        costUsd: vulnEnrichCost,
        thresholdUsd: vulnEnrichThresholdUsd,
        pausedUntil,
      });
    }
  }

  if (redditIntelCost > redditIntelThresholdUsd) {
    const pausedUntil = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    ).toISOString();
    const { error: brakeError } = await supabase
      .from("feature_brakes")
      .upsert(
        {
          feature: "reddit_intel",
          paused_until: pausedUntil,
          reason: `Daily spend $${redditIntelCost.toFixed(2)} exceeded $${redditIntelThresholdUsd} cap`,
          set_by: "cost-daily-check",
          set_cost_usd: redditIntelCost,
          set_threshold_usd: redditIntelThresholdUsd,
          set_at: new Date().toISOString(),
        },
        { onConflict: "feature" },
      );
    if (brakeError) {
      logger.error("failed to set reddit_intel brake", {
        error: brakeError.message,
      });
    } else {
      redditBrakeSet = true;
      logger.warn("reddit_intel brake engaged", {
        costUsd: redditIntelCost,
        thresholdUsd: redditIntelThresholdUsd,
        pausedUntil,
      });
    }
  }

  if (charityCheckCost > charityCheckThresholdUsd) {
    const pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error: brakeError } = await supabase
      .from("feature_brakes")
      .upsert(
        {
          feature: "charity_check",
          paused_until: pausedUntil,
          reason: `Daily spend $${charityCheckCost.toFixed(2)} exceeded $${charityCheckThresholdUsd} cap`,
          set_by: "cost-daily-check",
          set_cost_usd: charityCheckCost,
          set_threshold_usd: charityCheckThresholdUsd,
          set_at: new Date().toISOString(),
        },
        { onConflict: "feature" },
      );
    if (brakeError) {
      logger.error("failed to set charity_check brake", { error: brakeError.message });
    } else {
      charityCheckBrakeSet = true;
      logger.warn("charity_check brake engaged", {
        costUsd: charityCheckCost,
        thresholdUsd: charityCheckThresholdUsd,
        pausedUntil,
      });
    }
  }

  if (phoneFootprintCost > phoneFootprintThresholdUsd) {
    const pausedUntil = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    ).toISOString();
    const { error: brakeError } = await supabase
      .from("feature_brakes")
      .upsert(
        {
          feature: "phone_footprint",
          paused_until: pausedUntil,
          reason: `Daily spend $${phoneFootprintCost.toFixed(2)} exceeded $${phoneFootprintThresholdUsd} cap (Vonage $${vonageCost.toFixed(2)} + telemetry $${phoneFootprintTelemetryCost.toFixed(2)})`,
          set_by: "cost-daily-check",
          set_cost_usd: phoneFootprintCost,
          set_threshold_usd: phoneFootprintThresholdUsd,
          set_at: new Date().toISOString(),
        },
        { onConflict: "feature" },
      );
    if (brakeError) {
      logger.error("failed to set phone_footprint brake", {
        error: brakeError.message,
      });
    } else {
      phoneFootprintBrakeSet = true;
      logger.warn("phone_footprint brake engaged", {
        costUsd: phoneFootprintCost,
        vonageCost,
        thresholdUsd: phoneFootprintThresholdUsd,
        pausedUntil,
      });
    }
  }

  if (shopSignalCost > shopSignalThresholdUsd) {
    const pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error: brakeError } = await supabase
      .from("feature_brakes")
      .upsert(
        {
          feature: "shop_signal",
          paused_until: pausedUntil,
          reason: `Daily spend $${shopSignalCost.toFixed(2)} exceeded $${shopSignalThresholdUsd} cap`,
          set_by: "cost-daily-check",
          set_cost_usd: shopSignalCost,
          set_threshold_usd: shopSignalThresholdUsd,
          set_at: new Date().toISOString(),
        },
        { onConflict: "feature" },
      );
    if (brakeError) {
      logger.error("failed to set shop_signal brake", {
        error: brakeError.message,
      });
    } else {
      shopSignalBrakeSet = true;
      logger.warn("shop_signal brake engaged", {
        costUsd: shopSignalCost,
        thresholdUsd: shopSignalThresholdUsd,
        pausedUntil,
      });
    }
  }

  if (shopfrontCloneOutreachCost > shopfrontCloneOutreachThresholdUsd) {
    const pausedUntil = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    ).toISOString();
    const { error: brakeError } = await supabase
      .from("feature_brakes")
      .upsert(
        {
          feature: "shopfront_clone_outreach",
          paused_until: pausedUntil,
          reason: `Daily spend $${shopfrontCloneOutreachCost.toFixed(2)} exceeded $${shopfrontCloneOutreachThresholdUsd} cap`,
          set_by: "cost-daily-check",
          set_cost_usd: shopfrontCloneOutreachCost,
          set_threshold_usd: shopfrontCloneOutreachThresholdUsd,
          set_at: new Date().toISOString(),
        },
        { onConflict: "feature" },
      );
    if (brakeError) {
      logger.error("failed to set shopfront_clone_outreach brake", {
        error: brakeError.message,
      });
    } else {
      shopfrontCloneOutreachBrakeSet = true;
      logger.warn("shopfront_clone_outreach brake engaged", {
        costUsd: shopfrontCloneOutreachCost,
        thresholdUsd: shopfrontCloneOutreachThresholdUsd,
        pausedUntil,
      });
    }
  }

  // Truncate to top 3 for the Telegram message (UX — keep it scannable).
  const topForTelegram = top.slice(0, 3);

  const lines: string[] = [
    `⚠️ <b>Ask Arthur daily cost alert</b>`,
    ``,
    `Today's spend: <b>$${totalCostUsd.toFixed(2)}</b> across ${eventCount.toLocaleString()} events`,
    `Threshold: $${thresholdUsd.toFixed(2)}`,
    ``,
    `<b>Top features today:</b>`,
  ];
  for (const t of topForTelegram) {
    lines.push(
      `• ${t.feature} (${t.provider}) — $${t.cost.toFixed(
        2,
      )} · ${t.events.toLocaleString()} events`,
    );
  }
  if (brakeSet) {
    lines.push(
      "",
      `🛑 <b>vuln_au_enrichment brake engaged</b> — paused for 24h (spend $${vulnEnrichCost.toFixed(2)} > $${vulnEnrichThresholdUsd} cap)`,
    );
  }
  if (redditBrakeSet) {
    lines.push(
      "",
      `🛑 <b>reddit_intel brake engaged</b> — paused for 24h (spend $${redditIntelCost.toFixed(2)} > $${redditIntelThresholdUsd} cap)`,
    );
  }
  if (phoneFootprintBrakeSet) {
    lines.push(
      "",
      `🛑 <b>phone_footprint brake engaged</b> — paused for 24h (spend $${phoneFootprintCost.toFixed(2)} > $${phoneFootprintThresholdUsd} cap)`,
    );
  }
  if (charityCheckBrakeSet) {
    lines.push(
      "",
      `🛑 <b>charity_check brake engaged</b> — paused for 24h (spend $${charityCheckCost.toFixed(2)} > $${charityCheckThresholdUsd} cap)`,
    );
  }
  if (shopSignalBrakeSet) {
    lines.push(
      "",
      `🛑 <b>shop_signal brake engaged</b> — paused for 24h (spend $${shopSignalCost.toFixed(2)} > $${shopSignalThresholdUsd} cap)`,
    );
  }
  if (shopfrontCloneOutreachBrakeSet) {
    lines.push(
      "",
      `🛑 <b>shopfront_clone_outreach brake engaged</b> — paused for 24h (spend $${shopfrontCloneOutreachCost.toFixed(2)} > $${shopfrontCloneOutreachThresholdUsd} cap)`,
    );
  }
  lines.push("", `Full breakdown: https://askarthur.au/admin/costs`);

  await sendAdminTelegramMessage(lines.join("\n"));

  return NextResponse.json({
    alerted: true,
    totalCostUsd,
    thresholdUsd,
    eventCount,
    top: topForTelegram,
    brakeSet,
    vulnEnrichCost,
    redditBrakeSet,
    redditIntelCost,
    phoneFootprintBrakeSet,
    phoneFootprintCost,
    charityCheckBrakeSet,
    charityCheckCost,
    shopSignalBrakeSet,
    shopSignalCost,
    shopfrontCloneOutreachBrakeSet,
    shopfrontCloneOutreachCost,
  });
}
