// Provider 3a + 4: Vonage — Number Insight v2 `fraud_score` (primary for
// pillar 3) + CAMARA SIM Swap + Device Swap (pillar 4).
//
// Auth model (per Vonage docs):
//   - Number Insight v2 accepts Basic auth (API key + secret).
//   - CAMARA endpoints require an Application-scoped RS256 JWT built from
//     the private key of a Vonage Application with the relevant capability
//     (sim-swap / device-swap) enabled.
//
// Behaviour on missing credentials:
//   - No VONAGE_API_KEY / VONAGE_API_SECRET → both pillars unavailable with
//     reason=vonage_disabled.
//   - API_KEY present but no VONAGE_APPLICATION_ID / VONAGE_PRIVATE_KEY →
//     reputation pillar works (NI v2 Basic auth), but SIM/Device swap
//     pillar reports unavailable with reason=camara_not_configured.
//
// Error handling follows the plan's graceful-degradation rule: a 403 / 404
// / 422 from CAMARA (carrier not enrolled via Aduna) does NOT fail the
// request — it yields `available: false` for that pillar so the scorer
// redistributes weight. Only unexpected 5xx / network errors bubble up.

import { createSign } from "node:crypto";
import { logger } from "@askarthur/utils/logger";
import type { ProviderContract } from "../provider-contract";
import { unavailablePillar } from "../provider-contract";
import type { PillarResult } from "../types";
import { createServiceClient } from "@askarthur/supabase/server";
import { hashMsisdn } from "../normalize";

const VONAGE_NI_URL = "https://api.nexmo.com/v2/ni";
const VONAGE_SIM_SWAP_URL = "https://api-eu.vonage.com/camara/sim-swap/v040/check";
const VONAGE_DEVICE_SWAP_URL = "https://api-eu.vonage.com/camara/device-status/v0/device-swap";
const DEFAULT_MAX_AGE_HOURS = 240;

// ---------------------------------------------------------------------------
// JWT (RS256) — minimal inline implementation to avoid pulling in `jsonwebtoken`.
// ---------------------------------------------------------------------------
// Vonage Application JWTs are RS256 with claims:
//   { application_id, iat, jti, exp }
// This helper returns a cached token with 60s headroom.

interface CachedJwt {
  token: string;
  expiresAt: number;
}
let _jwtCache: CachedJwt | null = null;

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildVonageJwt(): string | null {
  const appId = process.env.VONAGE_APPLICATION_ID;
  const privateKey = process.env.VONAGE_PRIVATE_KEY;
  if (!appId || !privateKey) return null;

  const now = Math.floor(Date.now() / 1000);
  // 5-minute JWT; cache for 4 minutes to stay comfortably inside validity.
  if (_jwtCache && _jwtCache.expiresAt > now + 60) return _jwtCache.token;

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    application_id: appId,
    iat: now,
    jti: `pf-${now}-${Math.random().toString(36).slice(2, 10)}`,
    exp: now + 5 * 60,
  };

  const signingInput =
    base64UrlEncode(JSON.stringify(header)) +
    "." +
    base64UrlEncode(JSON.stringify(payload));

  try {
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    // Private key may come through env with `\n` literal — normalise.
    const pem = privateKey.replace(/\\n/g, "\n");
    const signature = signer.sign(pem);
    const token = signingInput + "." + base64UrlEncode(signature);
    _jwtCache = { token, expiresAt: now + 4 * 60 };
    return token;
  } catch (err) {
    logger.error("Vonage JWT sign failed", { error: String(err) });
    return null;
  }
}

function getBasicAuth(): string | null {
  const key = process.env.VONAGE_API_KEY;
  const secret = process.env.VONAGE_API_SECRET;
  if (!key || !secret) return null;
  return "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
}

// ---------------------------------------------------------------------------
// Telemetry helper — one row per Vonage call in telco_api_usage.
// ---------------------------------------------------------------------------
async function recordUsage(args: {
  endpoint: string;
  userId?: string;
  orgId?: string;
  msisdnHash: string;
  status: "ok" | "timeout" | "error" | "rate_limited" | "unauthorized";
  latencyMs: number;
  costUsd?: number;
  metadata?: Record<string, unknown>;
}) {
  const supa = createServiceClient();
  if (!supa) return;
  try {
    await supa.from("telco_api_usage").insert({
      provider: "vonage",
      endpoint: args.endpoint,
      user_id: args.userId ?? null,
      org_id: args.orgId ?? null,
      msisdn_hash: args.msisdnHash,
      status: args.status,
      latency_ms: args.latencyMs,
      cost_usd: args.costUsd ?? null,
      metadata: args.metadata ?? {},
    });
  } catch (err) {
    logger.warn("recordUsage insert failed", { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// NI v2 — pillar 3 primary
// ---------------------------------------------------------------------------
interface NiV2Response {
  fraud_score?: { risk_score?: number; risk_recommendation?: string; label?: string };
  phone_validation?: { valid?: boolean; line_type?: string; country_code?: string; carrier?: { name?: string } };
}

async function callNumberInsight(
  msisdn: string,
  signal: AbortSignal,
): Promise<NiV2Response> {
  const auth = getBasicAuth();
  if (!auth) throw new Error("vonage_basic_auth_missing");

  const res = await fetch(VONAGE_NI_URL, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "phone",
      phone: msisdn,
      insights: ["fraud_score"],
    }),
    signal,
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(`vonage_ni_unauthorized:${res.status}`);
  }
  if (res.status === 429) {
    throw new Error("vonage_ni_rate_limited");
  }
  if (!res.ok) {
    throw new Error(`vonage_ni_http:${res.status}`);
  }
  return (await res.json()) as NiV2Response;
}

// ---------------------------------------------------------------------------
// CAMARA SIM Swap — pillar 4 primary
// ---------------------------------------------------------------------------
interface SimSwapResponse {
  swapped?: boolean;
  latestSimChange?: string;
}

async function callSimSwap(
  msisdn: string,
  signal: AbortSignal,
): Promise<SimSwapResponse | { degraded: true; reason: string }> {
  const jwt = buildVonageJwt();
  if (!jwt) return { degraded: true, reason: "camara_not_configured" };

  const res = await fetch(VONAGE_SIM_SWAP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phoneNumber: msisdn,
      maxAge: DEFAULT_MAX_AGE_HOURS,
    }),
    signal,
  });

  // 401/403/404/422 all map to "this carrier isn't enrolled yet" — graceful
  // degrade instead of fail. 429 too — we'd rather show partial than block.
  if ([401, 403, 404, 409, 422, 429].includes(res.status)) {
    return { degraded: true, reason: `camara_sim_swap_${res.status}` };
  }
  if (!res.ok) {
    throw new Error(`vonage_sim_swap_http:${res.status}`);
  }
  return (await res.json()) as SimSwapResponse;
}

async function callDeviceSwap(
  msisdn: string,
  signal: AbortSignal,
): Promise<SimSwapResponse | { degraded: true; reason: string }> {
  const jwt = buildVonageJwt();
  if (!jwt) return { degraded: true, reason: "camara_not_configured" };

  const res = await fetch(VONAGE_DEVICE_SWAP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phoneNumber: msisdn,
      maxAge: DEFAULT_MAX_AGE_HOURS,
    }),
    signal,
  });

  if ([401, 403, 404, 409, 422, 429].includes(res.status)) {
    return { degraded: true, reason: `camara_device_swap_${res.status}` };
  }
  if (!res.ok) {
    throw new Error(`vonage_device_swap_http:${res.status}`);
  }
  return (await res.json()) as SimSwapResponse;
}

// ---------------------------------------------------------------------------
// Provider — composes NI + SIM Swap + Device Swap into pillars 3 + 4.
// ---------------------------------------------------------------------------

function reputationScoreFromNi(ni: NiV2Response): number {
  // Vonage fraud_score.risk_score is 0-100. Pass through directly.
  const s = ni.fraud_score?.risk_score;
  if (typeof s === "number" && s >= 0 && s <= 100) return s;
  return 0;
}

function simSwapScore(
  sim: SimSwapResponse | { degraded: true; reason: string },
  dev: SimSwapResponse | { degraded: true; reason: string },
): { score: number; mostRecentAt: string | undefined } {
  if ("degraded" in sim || "degraded" in dev) {
    return { score: 0, mostRecentAt: undefined };
  }
  // SIM swap within max_age → 80. Device swap within max_age → +20.
  // This is aggressive on purpose: a recent SIM swap on a monitored number
  // should push the whole composite to the critical band, matching the
  // "SIM Swap Heartbeat" premium feature's urgency.
  let score = 0;
  if (sim.swapped) score += 80;
  if (dev.swapped) score += 20;
  return {
    score: Math.min(100, score),
    mostRecentAt: sim.swapped ? sim.latestSimChange : undefined,
  };
}

export const vonageProvider: ProviderContract = {
  id: "vonage",
  timeoutMs: 4000,

  async run(msisdn, ctx): Promise<PillarResult[]> {
    const msisdnHash = hashMsisdn(msisdn);
    if (!getBasicAuth()) {
      return [
        unavailablePillar("reputation", "vonage_disabled"),
        unavailablePillar("sim_swap", "vonage_disabled"),
      ];
    }

    const aborter = new AbortController();
    // Slightly tighter internal timeout than the orchestrator's per-provider
    // timeout, so we win the race and surface a clean `degraded` state.
    const internalTimer = setTimeout(() => aborter.abort(), 3500);

    const start = Date.now();
    const results = await Promise.allSettled([
      callNumberInsight(msisdn, aborter.signal),
      callSimSwap(msisdn, aborter.signal),
      callDeviceSwap(msisdn, aborter.signal),
    ]);
    clearTimeout(internalTimer);

    const latency = Date.now() - start;
    const [niR, simR, devR] = results;

    // --- Pillar 3: reputation
    let reputation: PillarResult;
    if (niR.status === "fulfilled") {
      const ni = niR.value;
      const score = reputationScoreFromNi(ni);
      reputation = {
        id: "reputation",
        score,
        confidence: 0.9,
        available: true,
        detail: {
          source: "vonage",
          fraud_score: score,
          risk_recommendation: ni.fraud_score?.risk_recommendation,
          label: ni.fraud_score?.label,
          valid: ni.phone_validation?.valid,
          carrier: ni.phone_validation?.carrier?.name,
          country_code: ni.phone_validation?.country_code,
        },
      };
      void recordUsage({
        endpoint: "v2/ni",
        userId: ctx.userId,
        orgId: ctx.orgId,
        msisdnHash,
        status: "ok",
        latencyMs: latency,
        costUsd: 0.04,
      });
    } else {
      const msg = String(niR.reason?.message || niR.reason);
      const statusTag = msg.includes("unauthorized")
        ? "unauthorized"
        : msg.includes("rate_limited")
          ? "rate_limited"
          : msg.includes("timed out")
            ? "timeout"
            : "error";
      reputation = unavailablePillar("reputation", `vonage_ni_${statusTag}`);
      void recordUsage({
        endpoint: "v2/ni",
        userId: ctx.userId,
        orgId: ctx.orgId,
        msisdnHash,
        status: statusTag,
        latencyMs: latency,
        metadata: { error: msg },
      });
    }

    // --- Pillar 4: sim_swap
    let simSwap: PillarResult;
    const simOk = simR.status === "fulfilled";
    const devOk = devR.status === "fulfilled";
    if (simOk && devOk) {
      const sim = simR.value;
      const dev = devR.value;
      if ("degraded" in sim || "degraded" in dev) {
        const reason =
          "degraded" in sim
            ? sim.reason
            : "degraded" in dev
              ? dev.reason
              : "camara_degraded";
        simSwap = unavailablePillar("sim_swap", reason);
      } else {
        const { score, mostRecentAt } = simSwapScore(sim, dev);
        simSwap = {
          id: "sim_swap",
          score,
          confidence: 0.95,
          available: true,
          detail: {
            sim_swapped: sim.swapped,
            device_swapped: dev.swapped,
            most_recent_swap_at: mostRecentAt,
            max_age_hours_checked: DEFAULT_MAX_AGE_HOURS,
          },
        };
      }
      void recordUsage({
        endpoint: "camara/sim-swap+device-swap",
        userId: ctx.userId,
        orgId: ctx.orgId,
        msisdnHash,
        status: "ok",
        latencyMs: latency,
        costUsd: 0.08,
      });
    } else {
      const reason = !simOk
        ? String(simR.status === "rejected" ? simR.reason?.message : "sim_unknown")
        : String(devR.status === "rejected" ? devR.reason?.message : "device_unknown");
      simSwap = unavailablePillar("sim_swap", `vonage_camara_${reason.slice(0, 32)}`);
      void recordUsage({
        endpoint: "camara/sim-swap+device-swap",
        userId: ctx.userId,
        orgId: ctx.orgId,
        msisdnHash,
        status: "error",
        latencyMs: latency,
        metadata: { error: reason },
      });
    }

    return [reputation, simSwap];
  },
};
