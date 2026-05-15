// Provider 4 (preferred AU path): Telstra direct CAMARA SIM Swap.
//
// Sits alongside the Vonage CAMARA provider in pillar 4. Both fire in
// parallel inside the orchestrator; the orchestrator picks Telstra over
// Vonage when both return an available result (Telstra carries higher
// confidence because it's the operator-direct path, no aggregator hop).
// Vonage continues to own the reputation pillar; Telstra only emits
// sim_swap.
//
// Auth model: OAuth2 client_credentials.
//   - POST {TELSTRA_API_BASE}/v2/oauth/token
//     body: grant_type=client_credentials&scope=NSMS-S
//     headers: Authorization: Basic <base64(client_id:client_secret)>
//   - Cached in-process for `expires_in - 60s` (same pattern as Vonage JWT).
//
// Endpoints (per CAMARA SIM Swap v2.x spec, mirrored on dev.telstra.com):
//   POST {TELSTRA_API_BASE}/sim-swap/v2/check
//     body: { phoneNumber: E.164, maxAge: hours (1..2400, default 240) }
//     200:  { swapped: boolean }
//   POST {TELSTRA_API_BASE}/sim-swap/v2/retrieve-date
//     body: { phoneNumber: E.164 }
//     200:  { latestSimChange: ISO-8601 | null, monitoredPeriod: int }
//
// Graceful degradation: 401/403/404/422/429 → degraded (carrier not enrolled
// or quota tripped) so the orchestrator can fall through to Vonage or
// carrier-drift. Only 5xx / network errors throw.
//
// The two `callTelstra*` functions are exported standalone so the on-demand
// `POST /api/sim-swap/check` endpoint can invoke them directly without
// spinning up the full orchestrator fan-out for a single-pillar question.

import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { createServiceClient } from "@askarthur/supabase/server";
import type { ProviderContract } from "../provider-contract";
import { unavailablePillar } from "../provider-contract";
import type { PillarResult } from "../types";
import { hashMsisdn } from "../normalize";

const DEFAULT_API_BASE = "https://tapi.telstra.com";
const DEFAULT_MAX_AGE_HOURS = 240; // 10 days, per CAMARA default
const OAUTH_SCOPE = "NSMS-S sim-swap";

// ---------------------------------------------------------------------------
// OAuth2 token cache — in-process, expiry-aware.
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string;
  expiresAt: number; // epoch seconds
}
let _tokenCache: CachedToken | null = null;
// Singleflight: when two parallel callers both miss the cache at once
// (e.g. orchestrator's Promise.allSettled over /check + /retrieve-date),
// the second waits on the first's in-flight token fetch instead of
// racing it. Without this we double-fetch tokens on every provider run.
let _tokenInflight: Promise<string | null> | null = null;

function getApiBase(): string {
  return process.env.TELSTRA_API_BASE?.replace(/\/$/, "") || DEFAULT_API_BASE;
}

function hasCredentials(): boolean {
  return Boolean(
    process.env.TELSTRA_CLIENT_ID && process.env.TELSTRA_CLIENT_SECRET,
  );
}

async function fetchAndCacheToken(signal: AbortSignal): Promise<string | null> {
  const clientId = process.env.TELSTRA_CLIENT_ID!;
  const clientSecret = process.env.TELSTRA_CLIENT_SECRET!;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${getApiBase()}/v2/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: OAUTH_SCOPE,
    }).toString(),
    signal,
  });

  if (!res.ok) {
    throw new Error(`telstra_oauth_http:${res.status}`);
  }

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    throw new Error("telstra_oauth_no_token");
  }
  const now = Math.floor(Date.now() / 1000);
  const ttl = typeof data.expires_in === "number" ? data.expires_in : 3600;
  _tokenCache = { token: data.access_token, expiresAt: now + ttl - 60 };
  return data.access_token;
}

async function getAccessToken(signal: AbortSignal): Promise<string | null> {
  if (!hasCredentials()) return null;
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache && _tokenCache.expiresAt > now + 60) {
    return _tokenCache.token;
  }
  if (_tokenInflight) return _tokenInflight;
  _tokenInflight = fetchAndCacheToken(signal).finally(() => {
    _tokenInflight = null;
  });
  return _tokenInflight;
}

/** Test-only: reset the in-process token cache + singleflight slot. */
export function _resetTelstraTokenCacheForTests(): void {
  _tokenCache = null;
  _tokenInflight = null;
}

// ---------------------------------------------------------------------------
// Telemetry — one row per Telstra call in telco_api_usage.
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
      provider: "telstra",
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
    logger.warn("telstra recordUsage insert failed", { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Raw call helpers — exported for the on-demand endpoint's direct use.
// ---------------------------------------------------------------------------

export type TelstraSimSwapCheckResult =
  | { kind: "ok"; swapped: boolean }
  | { kind: "degraded"; reason: string };

export type TelstraRetrieveDateResult =
  | {
      kind: "ok";
      latestSimChange: string | null;
      monitoredPeriod: number;
    }
  | { kind: "degraded"; reason: string };

const DEGRADABLE_STATUSES = new Set([401, 403, 404, 409, 422, 429]);

interface CallTelstraOpts {
  /** Hours to look back, 1..2400. Defaults to 240h (10 days). */
  maxAge?: number;
  /** Caller-supplied abort signal (orchestrator wraps with its own timeout). */
  signal?: AbortSignal;
  userId?: string;
  orgId?: string;
  /** When true, skip telemetry insert (handy for unit tests). */
  skipTelemetry?: boolean;
}

/**
 * Sync check: was the SIM changed in the last `maxAge` hours? Returns
 * `{ kind: 'ok', swapped }` on success, `{ kind: 'degraded', reason }` on
 * any well-known not-enrolled / quota response (caller decides whether to
 * fall back to Vonage / carrier-drift). Throws only on 5xx / network errors.
 */
export async function callTelstraSimSwap(
  msisdn: string,
  opts: CallTelstraOpts = {},
): Promise<TelstraSimSwapCheckResult> {
  if (!hasCredentials()) {
    return { kind: "degraded", reason: "telstra_not_configured" };
  }
  const maxAge = opts.maxAge ?? DEFAULT_MAX_AGE_HOURS;
  const msisdnHash = hashMsisdn(msisdn);
  const start = Date.now();

  try {
    const token = await getAccessToken(opts.signal ?? new AbortController().signal);
    if (!token) return { kind: "degraded", reason: "telstra_not_configured" };

    const res = await fetch(`${getApiBase()}/sim-swap/v2/check`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phoneNumber: msisdn, maxAge }),
      signal: opts.signal,
    });

    const latency = Date.now() - start;

    if (DEGRADABLE_STATUSES.has(res.status)) {
      if (!opts.skipTelemetry) {
        void recordUsage({
          endpoint: "sim-swap/v2/check",
          userId: opts.userId,
          orgId: opts.orgId,
          msisdnHash,
          status: res.status === 429 ? "rate_limited" : res.status === 401 ? "unauthorized" : "error",
          latencyMs: latency,
          metadata: { http_status: res.status },
        });
      }
      return { kind: "degraded", reason: `telstra_sim_swap_${res.status}` };
    }
    if (!res.ok) {
      throw new Error(`telstra_sim_swap_http:${res.status}`);
    }

    const body = (await res.json()) as { swapped?: boolean };
    if (!opts.skipTelemetry) {
      void recordUsage({
        endpoint: "sim-swap/v2/check",
        userId: opts.userId,
        orgId: opts.orgId,
        msisdnHash,
        status: "ok",
        latencyMs: latency,
        costUsd: 0.06,
        metadata: { max_age_hours: maxAge },
      });
    }
    return { kind: "ok", swapped: Boolean(body.swapped) };
  } catch (err) {
    const latency = Date.now() - start;
    const msg = String((err as Error)?.message || err);
    if (!opts.skipTelemetry) {
      void recordUsage({
        endpoint: "sim-swap/v2/check",
        userId: opts.userId,
        orgId: opts.orgId,
        msisdnHash,
        status: msg.includes("aborted") || msg.includes("timed out") ? "timeout" : "error",
        latencyMs: latency,
        metadata: { error: msg },
      });
    }
    throw err;
  }
}

/**
 * Last-swap timestamp + the operator's record-retention window. Useful for
 * the dashboard "Last swap: 7 Feb 2026" view. Same degradation contract as
 * /check.
 */
export async function callTelstraRetrieveDate(
  msisdn: string,
  opts: CallTelstraOpts = {},
): Promise<TelstraRetrieveDateResult> {
  if (!hasCredentials()) {
    return { kind: "degraded", reason: "telstra_not_configured" };
  }
  const msisdnHash = hashMsisdn(msisdn);
  const start = Date.now();

  try {
    const token = await getAccessToken(opts.signal ?? new AbortController().signal);
    if (!token) return { kind: "degraded", reason: "telstra_not_configured" };

    const res = await fetch(`${getApiBase()}/sim-swap/v2/retrieve-date`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phoneNumber: msisdn }),
      signal: opts.signal,
    });

    const latency = Date.now() - start;

    if (DEGRADABLE_STATUSES.has(res.status)) {
      if (!opts.skipTelemetry) {
        void recordUsage({
          endpoint: "sim-swap/v2/retrieve-date",
          userId: opts.userId,
          orgId: opts.orgId,
          msisdnHash,
          status: res.status === 429 ? "rate_limited" : res.status === 401 ? "unauthorized" : "error",
          latencyMs: latency,
          metadata: { http_status: res.status },
        });
      }
      return { kind: "degraded", reason: `telstra_retrieve_date_${res.status}` };
    }
    if (!res.ok) {
      throw new Error(`telstra_retrieve_date_http:${res.status}`);
    }

    const body = (await res.json()) as {
      latestSimChange?: string | null;
      monitoredPeriod?: number;
    };
    if (!opts.skipTelemetry) {
      void recordUsage({
        endpoint: "sim-swap/v2/retrieve-date",
        userId: opts.userId,
        orgId: opts.orgId,
        msisdnHash,
        status: "ok",
        latencyMs: latency,
        costUsd: 0.06,
      });
    }
    return {
      kind: "ok",
      latestSimChange: body.latestSimChange ?? null,
      monitoredPeriod: typeof body.monitoredPeriod === "number" ? body.monitoredPeriod : 0,
    };
  } catch (err) {
    const latency = Date.now() - start;
    const msg = String((err as Error)?.message || err);
    if (!opts.skipTelemetry) {
      void recordUsage({
        endpoint: "sim-swap/v2/retrieve-date",
        userId: opts.userId,
        orgId: opts.orgId,
        msisdnHash,
        status: msg.includes("aborted") || msg.includes("timed out") ? "timeout" : "error",
        latencyMs: latency,
        metadata: { error: msg },
      });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Provider — composes check + retrieve-date into a single sim_swap pillar.
// ---------------------------------------------------------------------------

function simSwapScoreFromTelstra(
  check: TelstraSimSwapCheckResult,
  date: TelstraRetrieveDateResult,
): { score: number; mostRecentAt: string | undefined } {
  if (check.kind !== "ok") return { score: 0, mostRecentAt: undefined };
  // Match the Vonage scoring shape (80 for swap, room for device-swap +20
  // when/if Telstra exposes device swap separately).
  const score = check.swapped ? 80 : 0;
  const mostRecentAt =
    date.kind === "ok" && date.latestSimChange ? date.latestSimChange : undefined;
  return { score, mostRecentAt };
}

export const telstraProvider: ProviderContract = {
  id: "telstra",
  // 3.5s internal cap leaves ~500ms inside the orchestrator's 6s batch
  // budget for slower providers. Matches the Vonage budget.
  timeoutMs: 4000,

  async run(msisdn, ctx): Promise<PillarResult[]> {
    if (!featureFlags.telstraSimSwap) {
      return [unavailablePillar("sim_swap", "telstra_disabled")];
    }
    if (!hasCredentials()) {
      return [unavailablePillar("sim_swap", "telstra_not_configured")];
    }

    const aborter = new AbortController();
    const internalTimer = setTimeout(() => aborter.abort(), 3500);

    let pillar: PillarResult;
    try {
      const [checkR, dateR] = await Promise.allSettled([
        callTelstraSimSwap(msisdn, {
          signal: aborter.signal,
          userId: ctx.userId,
          orgId: ctx.orgId,
        }),
        callTelstraRetrieveDate(msisdn, {
          signal: aborter.signal,
          userId: ctx.userId,
          orgId: ctx.orgId,
        }),
      ]);

      if (checkR.status !== "fulfilled") {
        const msg = String(checkR.reason?.message || checkR.reason);
        pillar = unavailablePillar("sim_swap", `telstra_check_${msg.slice(0, 32)}`);
      } else if (checkR.value.kind === "degraded") {
        pillar = unavailablePillar("sim_swap", checkR.value.reason);
      } else {
        const date: TelstraRetrieveDateResult =
          dateR.status === "fulfilled"
            ? dateR.value
            : { kind: "degraded", reason: "telstra_retrieve_date_unreachable" };
        const { score, mostRecentAt } = simSwapScoreFromTelstra(checkR.value, date);
        pillar = {
          id: "sim_swap",
          score,
          // 0.98 — operator-direct edges out Vonage's 0.95. When both are
          // available, orchestrator picks the higher-confidence provider.
          confidence: 0.98,
          available: true,
          detail: {
            source: "telstra",
            sim_swapped: checkR.value.swapped,
            most_recent_swap_at: mostRecentAt,
            monitored_period_days:
              date.kind === "ok" ? date.monitoredPeriod : undefined,
            max_age_hours_checked: DEFAULT_MAX_AGE_HOURS,
          },
        };
      }
    } finally {
      clearTimeout(internalTimer);
    }

    return [pillar];
  },
};
