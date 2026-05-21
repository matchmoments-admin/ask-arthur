// APIVoid Site Trustworthiness adapter — Shop Signal Stage 1 paid feed.
//
// Single-purpose provider Adapter: given a URL or bare host, calls APIVoid
// v2 `site-trust` and maps the response to a compact PaidProviderVerdict.
// Pure provider I/O — it does NOT call logCost (that lives in apps/web and
// a package cannot import an app). The caller (#321's Inngest function)
// logs cost from the `units` / `estimatedCostUsd` this returns. Same
// division of labour as the phone-footprint Twilio/Vonage adapters
// ("instrumented via logCost from the caller").
//
// Graceful degradation is the contract: every failure mode — missing key,
// brake engaged, unparseable host, HTTP error, timeout, malformed JSON —
// returns an `ApivoidSkip` (`{ ok: false, reason }`), never throws. The
// reason lets the caller tell a by-design `brake` skip from a genuine
// error so it only logs error telemetry for the latter (GitHub #349, F-B).
// The free Stage-0 commerce detector keeps working regardless.
//
// NOT called synchronously in /api/analyze. #321 wires it into a
// post-response Inngest fan-out. This module is the adapter + brake check
// only. Plan: docs/plans/shop-guard-v2.md §4 PR 2. Issue #319.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import type { PaidProviderVerdict } from "@askarthur/types";

const APIVOID_SITE_TRUST_URL = "https://api.apivoid.com/v2/site-trust";

// APIVoid charges 10 credits per Site Trustworthiness call. Notional USD
// is the Startup-tier effective rate ($83/mo ÷ 250k credits × 10). The
// 30-day trial is free, but we log the notional cost so the daily brake
// (SHOP_SIGNAL_CAP_USD) is exercised before the paid tier starts —
// discovering a broken brake on day 31 is the wrong time. Re-derive if the
// tier changes; cap-derivation table in docs/ops/shop-signal-config.md §3.
const APIVOID_CREDITS_PER_CALL = 10;
const APIVOID_USD_PER_CALL = 0.0033;

// APIVoid Site Trustworthiness runs live checks against the host, so a
// fresh scan can take several seconds. The adapter only runs in a
// background Inngest function (#321), never the request path, so a
// generous timeout is fine — better than a false `null` on a slow scan.
const APIVOID_TIMEOUT_MS = 10_000;

// trust_score.result is 0-100, higher = more trustworthy. Below SAFE_MIN a
// host is merely uncertain; below RISKY_MAX it is actively distrusted.
const TRUST_SCORE_SAFE_MIN = 70;
const TRUST_SCORE_RISKY_MAX = 30;

export interface ApivoidSiteTrust {
  paidProviderVerdict: PaidProviderVerdict;
  /** APIVoid credits consumed — the caller passes this to logCost. */
  units: number;
  /** Notional USD for the call — the caller passes this to logCost. */
  estimatedCostUsd: number;
}

/**
 * A call that was skipped or failed. `brake` is a by-design skip — the
 * cost brake is engaged, or the brake state is unverifiable (no Supabase
 * client / brake lookup error), so declining the paid call is the safe
 * default. The caller logs NO error telemetry for `brake`. Every other
 * reason is a genuine error worth a diagnostic row. See GitHub #349 (F-B).
 */
export interface ApivoidSkip {
  ok: false;
  reason: "no-key" | "brake" | "bad-host" | "http-error" | "timeout";
}

/** Best-effort hostname extraction. Accepts a full URL or a bare host. */
function extractHost(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    return url.hostname || null;
  } catch {
    return null;
  }
}

/**
 * Returns true when the shop_signal cost brake is engaged (paused_until in
 * the future). Defence-in-depth alongside the cost-daily-check gate. A null
 * Supabase client (env entirely missing) is treated as "skip the call" —
 * if the DB layer is down we also cannot logCost and the system is broadly
 * degraded, so declining a paid call is the safe default.
 */
async function isBrakeEngaged(): Promise<boolean> {
  const supabase = createServiceClient();
  if (!supabase) {
    logger.warn("apivoid: no Supabase client — skipping paid call (brake unverifiable)");
    return true;
  }
  const { data, error } = await supabase
    .from("feature_brakes")
    .select("paused_until")
    .eq("feature", "shop_signal")
    .maybeSingle();
  if (error) {
    logger.warn("apivoid: feature_brakes lookup failed — skipping paid call", {
      error: error.message,
    });
    return true;
  }
  return Boolean(
    data?.paused_until && new Date(data.paused_until).getTime() > Date.now(),
  );
}

/** Coerce an unknown JSON value to a finite number, else fallback. */
function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Map an APIVoid v2 `site-trust` response body to a PaidProviderVerdict.
 * Shape verified live 2026-05-20: `trust_score.result` and
 * `domain_blacklist.detections` are top-level; the boolean checks live
 * under `security_checks`. Unknown/missing fields degrade to safe-side
 * defaults rather than throwing.
 */
function mapResponse(body: unknown): PaidProviderVerdict {
  const r = (body ?? {}) as Record<string, unknown>;

  const trustScoreObj = (r.trust_score ?? {}) as Record<string, unknown>;
  const blacklistObj = (r.domain_blacklist ?? {}) as Record<string, unknown>;
  const checks = (r.security_checks ?? {}) as Record<string, unknown>;

  const trustScore = asNumber(trustScoreObj.result, 50);
  const blacklistDetections = asNumber(blacklistObj.detections, 0);

  const isBlacklisted =
    checks.is_domain_blacklisted === true || blacklistDetections > 0;
  const isSuspicious = checks.is_suspicious_domain === true;
  const isSuspended = checks.is_suspended_site === true;
  const isSinkholed = checks.is_sinkholed_domain === true;

  const flags: string[] = [];
  if (isBlacklisted) flags.push("domain-blacklisted");
  if (isSuspicious) flags.push("suspicious-domain");
  if (isSuspended) flags.push("suspended-site");
  if (isSinkholed) flags.push("sinkholed-domain");
  if (checks.is_most_abused_tld === true) flags.push("high-risk-tld");
  if (checks.is_ssl_expired === true) flags.push("ssl-expired");
  if (checks.is_valid_https === false) flags.push("no-valid-https");
  if (checks.is_email_spoofable === true) flags.push("email-spoofable");

  let verdict: PaidProviderVerdict["verdict"];
  if (isBlacklisted || trustScore < TRUST_SCORE_RISKY_MAX) {
    verdict = "risky";
  } else if (
    trustScore < TRUST_SCORE_SAFE_MIN ||
    isSuspicious ||
    isSuspended ||
    isSinkholed
  ) {
    verdict = "suspicious";
  } else {
    verdict = "safe";
  }

  return {
    provider: "apivoid",
    verdict,
    trustScore,
    blacklistDetections,
    flags,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Call APIVoid Site Trustworthiness for a URL or host. Returns the mapped
 * verdict plus cost metadata for the caller to log, or an `ApivoidSkip`
 * (`{ ok: false, reason }`) on any failure — missing key, brake engaged,
 * bad host, HTTP error, timeout, malformed JSON. Never throws. Callers
 * discriminate on `"ok" in result`.
 */
export async function getSiteTrustworthiness(
  input: string,
): Promise<ApivoidSiteTrust | ApivoidSkip> {
  const apiKey = process.env.APIVOID_API_KEY;
  if (!apiKey) {
    logger.warn("apivoid: APIVOID_API_KEY not set — skipping paid call");
    return { ok: false, reason: "no-key" };
  }

  const host = extractHost(input);
  if (!host) {
    logger.warn("apivoid: could not extract host from input — skipping", { input });
    return { ok: false, reason: "bad-host" };
  }

  if (await isBrakeEngaged()) {
    logger.warn("apivoid: shop_signal brake engaged — skipping paid call", { host });
    return { ok: false, reason: "brake" };
  }

  const startedAt = Date.now();
  try {
    const res = await fetch(APIVOID_SITE_TRUST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({ host }),
      signal: AbortSignal.timeout(APIVOID_TIMEOUT_MS),
    });

    if (!res.ok) {
      logger.warn("apivoid: site-trust HTTP error", { status: res.status, host });
      return { ok: false, reason: "http-error" };
    }

    const body = await res.json();
    const paidProviderVerdict = mapResponse(body);

    logger.info("apivoid: site-trust ok", {
      host,
      verdict: paidProviderVerdict.verdict,
      trustScore: paidProviderVerdict.trustScore,
      elapsedMs: Date.now() - startedAt,
    });

    return {
      paidProviderVerdict,
      units: APIVOID_CREDITS_PER_CALL,
      estimatedCostUsd: APIVOID_USD_PER_CALL,
    };
  } catch (err) {
    logger.error("apivoid: site-trust call failed", {
      error: String(err),
      host,
      elapsedMs: Date.now() - startedAt,
    });
    const reason =
      err instanceof DOMException && err.name === "TimeoutError"
        ? "timeout"
        : "http-error";
    return { ok: false, reason };
  }
}
