// Fan-out orchestrator — Promise.allSettled with per-provider timeouts
// inside a 6-second overall budget. Models on entity-enrichment.ts — no
// p-limit, no queue library, just allSettled + abort.

import { logger } from "@askarthur/utils/logger";
import { createServiceClient } from "@askarthur/supabase/server";
import type {
  Footprint,
  FootprintRequestContext,
  PillarResult,
  PillarId,
  Coverage,
} from "./types";
import { computeCompositeScore, initialCoverage, redactForFree } from "./scorer";
import { hashMsisdn } from "./normalize";
import { internalProvider } from "./providers/internal";
import { twilioProvider } from "./providers/twilio";
import { ipqsProvider } from "./providers/ipqs";
import { vonageProvider } from "./providers/vonage";
import { leakcheckProvider } from "./providers/leakcheck";
import { withTimeout, unavailablePillar, type ProviderContract } from "./provider-contract";

const BATCH_TIMEOUT_MS = 6000;
const TEASER_TTL_MS = 24 * 3600 * 1000;
const BASIC_TTL_MS = 7 * 24 * 3600 * 1000;
const FULL_TTL_MS = 7 * 24 * 3600 * 1000;

/**
 * All v1 providers, wired in the order:
 *   internal — free pillar; always runs
 *   twilio — identity (pillar 5)
 *   ipqs — reputation fallback (pillar 3b)
 *   vonage — reputation primary + sim_swap (pillars 3a + 4)
 *   leakcheck — breach (pillar 2)
 */
const PROVIDERS: ProviderContract[] = [
  internalProvider,
  twilioProvider,
  ipqsProvider,
  vonageProvider,
  leakcheckProvider,
];

/**
 * Run every provider in parallel inside a single 6s budget. Providers that
 * time out or throw yield an unavailable pillar for their slot; the scorer
 * redistributes weight. Coverage map is populated from the per-provider
 * return values.
 *
 * Returns a fully-populated Footprint ready for persistence. Does NOT write
 * to phone_footprints — the route handles persistence so it can control
 * idempotency_key and expires_at according to the effective tier.
 */
export async function buildPhoneFootprint(
  msisdn: string,
  ctx: FootprintRequestContext,
): Promise<Footprint> {
  const msisdnHash = hashMsisdn(msisdn);
  const now = new Date();

  // Launch every provider behind its own timeout wrapper. allSettled means
  // one slow provider never fails the whole lookup.
  const settled = await Promise.allSettled(
    PROVIDERS.map((p) => withTimeout(p.run(msisdn, ctx), p.timeoutMs, p.id)),
  );

  // Seed all five pillars as unavailable; providers fill in as they arrive.
  const pillars: Record<PillarId, PillarResult> = {
    scam_reports: unavailablePillar("scam_reports", "not_run"),
    breach: unavailablePillar("breach", "not_run"),
    reputation: unavailablePillar("reputation", "not_run"),
    sim_swap: unavailablePillar("sim_swap", "not_run"),
    identity: unavailablePillar("identity", "not_run"),
  };
  const coverage: Coverage = initialCoverage();
  const providersUsed: string[] = [];

  // Track whether a given pillar has been filled already — providers may
  // emit the same pillar id (Vonage reputation + IPQS reputation both map
  // to pillar 3). Primary source wins: Vonage first when available, then
  // IPQS as fallback.
  const primaryReputationFromVonage = { set: false };

  settled.forEach((r, i) => {
    const provider = PROVIDERS[i]!;
    if (r.status !== "fulfilled") {
      logger.warn(`pf provider failed: ${provider.id}`, {
        error: String(r.reason?.message || r.reason),
      });
      // Mark coverage based on which provider went down.
      stampCoverageForDown(coverage, provider.id);
      return;
    }

    providersUsed.push(provider.id);
    const emitted = Array.isArray(r.value) ? r.value : [r.value];

    for (const pillar of emitted) {
      if (pillar.id === "reputation") {
        // Vonage reputation wins over IPQS. IPQS only overwrites if Vonage
        // didn't produce an available reputation result.
        if (provider.id === "vonage" && pillar.available) {
          pillars.reputation = pillar;
          primaryReputationFromVonage.set = true;
          coverage.vonage = "live";
        } else if (provider.id === "ipqs") {
          if (!primaryReputationFromVonage.set) {
            pillars.reputation = pillar;
            coverage.ipqs = pillar.available ? "fallback" : "disabled";
          } else if (!pillar.available) {
            coverage.ipqs = "degraded";
          } else {
            // Vonage already populated; keep IPQS available for comparison
            // but don't overwrite pillar 3.
            coverage.ipqs = "fallback";
          }
        } else if (provider.id === "vonage" && !pillar.available) {
          coverage.vonage = vonageCoverageFromReason(pillar.reason);
        }
        continue;
      }
      if (pillar.id === "sim_swap") {
        pillars.sim_swap = pillar;
        if (provider.id === "vonage") {
          coverage.vonage = pillar.available
            ? "live"
            : vonageCoverageFromReason(pillar.reason);
        }
        continue;
      }
      if (pillar.id === "breach") {
        pillars.breach = pillar;
        coverage.leakcheck = pillar.available
          ? "live"
          : pillar.reason === "leakcheck_disabled"
            ? "disabled"
            : "degraded";
        continue;
      }
      if (pillar.id === "identity") {
        pillars.identity = pillar;
        coverage.twilio = pillar.available ? "live" : "degraded";
        continue;
      }
      if (pillar.id === "scam_reports") {
        pillars.scam_reports = pillar;
        coverage.internal = pillar.available ? "live" : "degraded";
        continue;
      }
    }
  });

  // Final coverage resolution for providers that never reported.
  if (!providersUsed.includes("vonage") && coverage.vonage === "disabled") {
    coverage.vonage = "disabled";
  }
  if (!providersUsed.includes("leakcheck-phone") && coverage.leakcheck === "disabled") {
    coverage.leakcheck = "disabled";
  }
  if (!providersUsed.includes("ipqs-phone") && coverage.ipqs === "disabled") {
    coverage.ipqs = "disabled";
  }

  // Compose the score from whatever pillars came back available.
  const { score, band } = computeCompositeScore(pillars);

  // Teaser / unverified callers get redacted pillar detail.
  const finalPillars =
    ctx.tier === "teaser" || !ctx.ownershipProven
      ? redactForFree(pillars)
      : pillars;

  const ttl = ctx.tier === "teaser" ? TEASER_TTL_MS : ctx.tier === "basic" ? BASIC_TTL_MS : FULL_TTL_MS;
  const footprint: Footprint = {
    msisdn_e164: msisdn,
    msisdn_hash: msisdnHash,
    tier: ctx.tier,
    composite_score: score,
    band,
    pillars: finalPillars,
    coverage,
    providers_used: providersUsed,
    explanation: null, // Claude-generated in a later phase; cheap templated copy injected by the route for teaser.
    generated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttl).toISOString(),
    request_id: ctx.requestId,
  };

  return footprint;
}

/**
 * Persist a Footprint snapshot to `phone_footprints`. Safe to call fire-and-
 * forget; the route can await if it wants idempotency on retries.
 */
export async function persistFootprint(
  fp: Footprint,
  owner: { userId?: string; orgId?: string },
): Promise<number | null> {
  const supa = createServiceClient();
  if (!supa) return null;

  const tierGenerated = fp.tier === "teaser" ? "teaser" : fp.tier === "basic" ? "basic" : "full";
  const { data, error } = await supa
    .from("phone_footprints")
    .insert({
      user_id: owner.userId ?? null,
      org_id: owner.orgId ?? null,
      msisdn_e164: fp.msisdn_e164,
      msisdn_hash: fp.msisdn_hash,
      tier_generated: tierGenerated,
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

  if (error) {
    logger.warn("persistFootprint insert failed", { error: String(error.message) });
    return null;
  }
  return data?.id ?? null;
}

// ---------------------------------------------------------------------------

function stampCoverageForDown(coverage: Coverage, providerId: string) {
  switch (providerId) {
    case "internal-scam-db":
      coverage.internal = "degraded";
      break;
    case "twilio-lookup":
      coverage.twilio = "degraded";
      break;
    case "ipqs-phone":
      coverage.ipqs = "degraded";
      break;
    case "vonage":
      coverage.vonage = "degraded";
      break;
    case "leakcheck-phone":
      coverage.leakcheck = "degraded";
      break;
  }
}

function vonageCoverageFromReason(reason: string | undefined): Coverage["vonage"] {
  if (!reason) return "degraded";
  if (reason === "vonage_disabled") return "disabled";
  if (reason.startsWith("camara_not_configured")) return "pending";
  if (reason.includes("403") || reason.includes("404") || reason.includes("422") || reason.includes("409")) {
    return "pending";
  }
  return "degraded";
}

// Re-export the overall budget for tests / route handlers that need to match.
export { BATCH_TIMEOUT_MS };
