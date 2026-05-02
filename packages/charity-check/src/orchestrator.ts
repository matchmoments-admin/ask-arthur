// Charity Check fan-out orchestrator — Promise.allSettled with per-provider
// timeouts inside an overall budget. Mirrors phone-footprint/orchestrator.ts
// in shape; ADR-0002 documents the "two adapters → real seam" decision.
//
// Wiring order (v0.2a):
//   acnc         — local Postgres lookup        (weight 0.5; runs when name OR abn)
//   abr          — ABR Lookup with DGR fields   (weight 0.3; runs when abn supplied)
//   donation_url — Safe Browsing + WHOIS age    (weight 0.2; runs when donationUrl supplied)
//
// Each provider self-reports `available: false` when its prerequisite input
// isn't present (e.g. abr returns `no_abn_provided` when only a name was
// given); the scorer redistributes weight pro-rata across pillars that did
// run. Coverage stays "live" for non-running providers when the omission is
// caller-controlled (no abn supplied), "degraded" when the upstream actually
// failed.

import { logger } from "@askarthur/utils/logger";

import { acncProvider } from "./providers/acnc";
import { abrProvider } from "./providers/abr";
import { donationUrlProvider } from "./providers/donation-url";
import {
  unavailablePillar,
  withTimeout,
  type CharityProviderContract,
} from "./provider-contract";
import {
  applyVerdictFloors,
  computeCompositeScore,
  explainResult,
} from "./scorer";
import type {
  CharityCheckInput,
  CharityCheckResult,
  CharityCoverage,
  CharityPillarId,
  CharityPillarResult,
} from "./types";

const BATCH_TIMEOUT_MS = 5000;

const PROVIDERS: CharityProviderContract[] = [
  acncProvider,
  abrProvider,
  donationUrlProvider,
];

/**
 * Run every provider in parallel inside a single 5s budget. Providers that
 * time out or throw yield an unavailable pillar for their slot; the scorer
 * redistributes weight pro-rata. Coverage map is populated from per-provider
 * outcomes for the UI to render "X is unavailable" hints.
 *
 * Does NOT persist anywhere — the route owns persistence (cost telemetry,
 * idempotency, scam_reports linkage). The orchestrator returns a fully-
 * populated CharityCheckResult ready for the wire.
 */
export async function runCharityCheck(
  input: CharityCheckInput,
): Promise<CharityCheckResult> {
  if (!input.abn && !input.name) {
    // Defensive — the route's Zod schema rejects this case at the boundary,
    // but keeping the engine self-protecting means future internal callers
    // can't bypass it.
    throw new Error("CharityCheckInput requires either abn or name");
  }

  const settled = await Promise.allSettled(
    PROVIDERS.map((p) =>
      withTimeout(
        Promise.resolve(p.run(input)),
        Math.min(p.timeoutMs, BATCH_TIMEOUT_MS),
        p.id,
      ),
    ),
  );

  const pillars: Record<CharityPillarId, CharityPillarResult> = {
    acnc_registration: unavailablePillar("acnc_registration", "not_run"),
    abr_dgr: unavailablePillar("abr_dgr", "not_run"),
    donation_url: unavailablePillar("donation_url", "not_run"),
  };
  const coverage: CharityCoverage = {
    acnc: "live",
    abr: "live",
    donation_url: "live",
  };
  const providersUsed: string[] = [];

  settled.forEach((r, i) => {
    const provider = PROVIDERS[i]!;
    if (r.status !== "fulfilled") {
      logger.warn(`charity-check provider failed: ${provider.id}`, {
        error: String((r.reason as Error)?.message ?? r.reason),
      });
      stampCoverageDown(coverage, provider.id);
      return;
    }
    providersUsed.push(provider.id);
    const emitted = Array.isArray(r.value) ? r.value : [r.value];
    for (const pillar of emitted) {
      pillars[pillar.id] = pillar;
      if (!pillar.available) stampCoverageDown(coverage, provider.id, pillar.reason);
    }
  });

  const { score, verdict: baseVerdict } = computeCompositeScore(pillars);
  const verdict = applyVerdictFloors(baseVerdict, input, pillars);

  // Pull the canonical donation URL from the ACNC pillar's detail when
  // we have a registered match. This is the URL the verdict CTA points
  // at — never the URL a fundraiser supplied.
  const officialDonationUrl =
    (pillars.acnc_registration?.detail?.charity_website as string | null | undefined) ??
    null;

  const generated_at = new Date().toISOString();
  const draft: Pick<CharityCheckResult, "verdict" | "pillars" | "official_donation_url"> = {
    verdict,
    pillars,
    official_donation_url: officialDonationUrl,
  };
  const explanation = explainResult(draft);

  return {
    verdict,
    composite_score: score,
    pillars,
    coverage,
    providers_used: providersUsed,
    explanation,
    official_donation_url: officialDonationUrl,
    generated_at,
    request_id: input.requestId,
  };
}

function stampCoverageDown(
  coverage: CharityCoverage,
  providerId: string,
  reason?: string,
) {
  switch (providerId) {
    case "acnc":
      coverage.acnc = reason === "supabase_client_unavailable" ? "disabled" : "degraded";
      break;
    case "abr":
      coverage.abr = reason === "no_abn_provided" ? "disabled" : "degraded";
      break;
    case "donation_url":
      // "no_url_provided" is a clean disable (caller didn't supply a URL).
      // "all_legs_failed" / "invalid_url" / "private_or_invalid_url" mean
      // we tried but couldn't get a useful answer — degraded.
      coverage.donation_url = reason === "no_url_provided" ? "disabled" : "degraded";
      break;
  }
}

export { BATCH_TIMEOUT_MS };
