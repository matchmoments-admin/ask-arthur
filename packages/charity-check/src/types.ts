// Canonical type definitions for the Charity Legitimacy Check engine.
//
// Types live here (not in @askarthur/types) for the same reason as
// phone-footprint/types.ts — internal to the engine package, the API route
// imports CharityCheckResult via the package barrel and re-projects to the
// wire format.
//
// Vocabulary: a "Pillar" is one external-source contribution to the
// composite Charity Check Result, with its own score / confidence /
// availability. The Result is the multi-pillar composite returned to the
// caller. Verdict reuses the canonical 4-level scale from CONTEXT.md
// (SAFE | UNCERTAIN | SUSPICIOUS | HIGH_RISK) — pillar-specific concerns
// live inside the pillars[] sub-object, not in a charity-only verdict enum.

import type { Verdict } from "@askarthur/types";

/** Pillars feeding the composite legitimacy score.
 *
 * Four pillars as of v0.2c. PFRA membership is additive only — when a
 * charity IS a PFRA member it contributes a positive (low-risk) signal,
 * but non-membership is NOT penalised because PFRA only covers face-
 * to-face fundraising and many legitimate charities never join. */
export type CharityPillarId =
  | "acnc_registration" // ACNC Charity Register lookup            (v0.1)
  | "abr_dgr" //          ABR Lookup + DGR endorsement             (v0.1)
  | "donation_url" //     Safe Browsing + WHOIS + headers          (v0.2a)
  | "pfra"; //            Public Fundraising Regulatory Association (v0.2c)

/** Per-pillar output from a provider. Score is 0..100 where higher = more
 *  risk (matches Phone Footprint convention so future shared abstraction
 *  doesn't fight a sign flip). */
export interface CharityPillarResult {
  id: CharityPillarId;
  /** 0..100, higher = more risk. */
  score: number;
  /** 0..1. Used by the scorer when blending future fallback providers. */
  confidence: number;
  /** If false, scorer redistributes this pillar's weight across available ones. */
  available: boolean;
  /** Short machine-readable reason for `available = false`, if applicable. */
  reason?: string;
  /** Provider-specific structured detail. May be redacted by the route at
   *  the wire boundary depending on tier. */
  detail?: Record<string, unknown>;
}

/** Per-provider coverage status surfaced to the UI. Mirrors Phone
 *  Footprint's Coverage type — the consumer can render "we couldn't reach
 *  X" hints without opening the full pillar payload. */
export interface CharityCoverage {
  /** Local Postgres mirror of the ACNC register. 'live' once the v83
   *  ingest cycle has populated rows; 'degraded' on Supabase outage;
   *  'disabled' if the service client is misconfigured. */
  acnc: "live" | "degraded" | "disabled";
  /** ABR Lookup web service. 'live' on success; 'degraded' on transient
   *  errors or rate limiting; 'disabled' when ABN_LOOKUP_GUID is unset. */
  abr: "live" | "degraded" | "disabled";
  /** Safe Browsing + WHOIS donation-URL pillar (v0.2a). */
  donation_url: "live" | "degraded" | "disabled";
  /** PFRA local mirror in `pfra_members` (v0.2c). 'disabled' before the
   *  scraper has populated rows; 'live' once members are present. */
  pfra: "live" | "degraded" | "disabled";
}

/** Recent Scamwatch alerts mentioning the charity by name. Surfaces as
 *  context on the verdict screen — explicitly NOT a pillar / score input,
 *  because Scamwatch alerts often describe the impersonator (not the
 *  legitimate charity), so flagging the legitimate charity for them
 *  would be a false positive. */
export interface ScamwatchAlertContext {
  count: number;
  recent: Array<{
    title: string;
    url: string;
    publishedAt: string | null;
  }>;
}

/** Final composite charity check returned to API callers. */
export interface CharityCheckResult {
  /** Canonical 4-level verdict from CONTEXT.md — SAFE | UNCERTAIN |
   *  SUSPICIOUS | HIGH_RISK. Derived from `composite_score` plus a small
   *  set of hard-floor rules (e.g. typosquat impersonation forces
   *  HIGH_RISK regardless of score). */
  verdict: Verdict;
  /** 0..100, higher = more risk. */
  composite_score: number;
  /** Per-pillar payloads. */
  pillars: Record<CharityPillarId, CharityPillarResult>;
  /** Coverage map for surfacing "X is unavailable" UI hints. */
  coverage: CharityCoverage;
  /** Provider IDs that actually contributed a pillar this run. Useful for
   *  the consumer-side "powered by" footer + the B2B explainability story. */
  providers_used: string[];
  /** Plain-English summary intended for the verdict screen — derived
   *  template-only in v0.1, may swap to Claude Haiku in a follow-up. */
  explanation: string;
  /** Best canonical donation URL we could surface, if any. Pulled from
   *  the ACNC register's `charity_website` so a SAFE verdict can deep-link
   *  the user to the official site rather than a fundraiser-supplied URL. */
  official_donation_url: string | null;
  /** ISO 8601 generated timestamp (also stamped onto cost_telemetry rows). */
  generated_at: string;
  /** Optional caller-supplied or server-generated correlation id. */
  request_id?: string;
  /** Recent Scamwatch alerts mentioning the charity name (v0.2c). NOT
   *  a pillar — context for the verdict screen's collapsible section. */
  scamwatch_alerts?: ScamwatchAlertContext;
}

/** Minimal shape consumed by the orchestrator at the API/route boundary.
 *
 * Either `abn` or `name` is required — the orchestrator will reject inputs
 * with neither at the schema layer. Optional fields shape the run:
 *   - `paymentMethod` of cash/crypto/gift-card forces HIGH_RISK regardless
 *     of pillar scores (Scamwatch-validated heuristic for fake-charity
 *     scams). v0.1 collects this from the behavioural micro-flow input;
 *     v0.2's `<CharityChecker />` UI will populate it from a one-tap
 *     question set.
 *   - `donationUrl` will feed v0.2's pillar 3 (donation-URL scrutiny).
 *     Accepted now so the schema is forward-compatible. */
export interface CharityCheckInput {
  abn?: string;
  name?: string;
  donationUrl?: string;
  paymentMethod?: "card" | "regular_debit" | "cash" | "gift_card" | "crypto" | "bank_transfer";
  /** Optional caller-supplied correlation id (Stripe-style Idempotency-Key). */
  requestId?: string;
}
