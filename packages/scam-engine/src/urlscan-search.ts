// urlscan.io Search API — pivot from a confirmed phishing clone to OTHER sites
// on the same infrastructure (a phishing kit is usually deployed many times on
// one host/IP). Siblings on the same IP are strong evidence of one actor —
// stored as attribution.kit_siblings evidence today; folding them into the
// campaign-fingerprint grouping is a tracked follow-up (see kit-pivot.ts).
//
// The free-tier Search API is rate-limited, so callers cap searches/run and
// MUST distinguish a 429 (quota — stop, leave rows untouched to retry) from a
// genuine failure. Returns a discriminated outcome for exactly that.

import { logger } from "@askarthur/utils/logger";
import { logCost } from "./cost-log";

export interface UrlscanSearchHit {
  domain: string | null;
  url: string | null;
  lastSeen: string | null;
}

export type UrlscanSearchOutcome =
  | { ok: true; results: UrlscanSearchHit[]; total: number }
  | { ok: false; error: "rate_limited" | "http_error" | "no_key" | "exception" };

interface RawSearchResponse {
  results?: Array<{
    task?: { url?: string; domain?: string; time?: string };
    page?: { domain?: string; url?: string };
  }>;
  total?: number;
}

/**
 * Run a urlscan Search API query (e.g. `page.ip:"1.2.3.4"`). `size` caps hits.
 * Free-tier — logged at $0 for volume visibility against the search quota.
 */
export async function searchURLScan(
  query: string,
  size = 50,
): Promise<UrlscanSearchOutcome> {
  const apiKey = process.env.URLSCAN_API_KEY;
  if (!apiKey) {
    logger.warn("URLSCAN_API_KEY not set, skipping urlscan search");
    return { ok: false, error: "no_key" };
  }

  try {
    const res = await fetch(
      `https://urlscan.io/api/v1/search/?q=${encodeURIComponent(query)}&size=${size}`,
      {
        headers: { "API-Key": apiKey },
        signal: AbortSignal.timeout(8000),
      },
    );

    if (res.status === 429) {
      // Quota exhaustion — NOT a resource failure. Caller stops the run.
      return { ok: false, error: "rate_limited" };
    }
    if (!res.ok) {
      logger.warn("urlscan search non-200", { status: res.status, query });
      return { ok: false, error: "http_error" };
    }

    void logCost({
      feature: "shopfront_clone_watch",
      provider: "urlscan",
      operation: "search",
      units: 1,
      estimatedCostUsd: 0,
    });

    const json = (await res.json()) as RawSearchResponse;
    const results: UrlscanSearchHit[] = (json.results ?? []).map((r) => ({
      domain: r.page?.domain ?? r.task?.domain ?? null,
      url: r.page?.url ?? r.task?.url ?? null,
      lastSeen: r.task?.time ?? null,
    }));
    return { ok: true, results, total: json.total ?? results.length };
  } catch (err) {
    logger.warn("urlscan search error", {
      error: err instanceof Error ? err.message : String(err),
      query,
    });
    return { ok: false, error: "exception" };
  }
}
