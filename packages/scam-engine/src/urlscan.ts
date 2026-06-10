// URL scanning via URLScan.io API.
// Async two-step process: submit URL → wait → retrieve results.
// Used by the urlscan-enrichment Inngest function, not inline enrichment.
// Graceful degradation: missing API key → skip, errors → empty result.

import { logger } from "@askarthur/utils/logger";

export interface URLScanResult {
  scanId: string;
  screenshotUrl: string | null;
  effectiveUrl: string;
  malicious: boolean;
  score: number;
  categories: string[];
  technologies: string[];
  serverInfo: {
    ip: string | null;
    country: string | null;
    asn: string | null;
  };
  domainAge: string | null;
}

export interface URLScanSubmission {
  uuid: string;
  apiUrl: string;
}

/**
 * Detailed submit result for callers that need to record why a submission
 * failed (e.g. clone-watch's persist-on-failure path, so the row gets
 * `urlscan_scanned_at = now()` and is picked up by tomorrow's rescan cron
 * instead of being stuck forever — see issue #441).
 *
 * Tagged union so callers do `if (r.ok) {...}` and TypeScript narrows.
 */
export type URLScanSubmitDetailed =
  | { ok: true; uuid: string; apiUrl: string }
  | {
      ok: false;
      /** Coarse-grained reason for telemetry + dashboard grouping */
      error:
        | "no_api_key"
        | "http_error"
        | "network_error"
        | "timeout"
        | "rate_limited"
        | "rejected";
      /** HTTP status when error came from a response (http_error / rate_limited / rejected) */
      status?: number;
      /** Best-effort human-readable detail — may include API error body */
      message?: string;
    };

const EMPTY_RESULT: URLScanResult = {
  scanId: "",
  screenshotUrl: null,
  effectiveUrl: "",
  malicious: false,
  score: 0,
  categories: [],
  technologies: [],
  serverInfo: { ip: null, country: null, asn: null },
  domainAge: null,
};

/**
 * Submit a URL for scanning. Returns a scan UUID for later retrieval.
 * Free tier: 100 scans/day (public), 5,000/day (paid).
 *
 * Existing legacy surface — returns `null` on any failure. New code
 * should prefer `submitURLScanWithDetails` so it can record the failure
 * reason (issue #441 — clone-watch row stuck-state).
 */
export async function submitURLScan(
  url: string,
): Promise<URLScanSubmission | null> {
  const result = await submitURLScanWithDetails(url);
  return result.ok ? { uuid: result.uuid, apiUrl: result.apiUrl } : null;
}

/**
 * Submit a URL for scanning, returning a discriminated result that
 * distinguishes success from each failure mode. Callers that need to
 * persist or surface the failure reason (e.g. clone-watch's
 * persist-on-failure path) should prefer this over `submitURLScan`.
 */
export async function submitURLScanWithDetails(
  url: string,
): Promise<URLScanSubmitDetailed> {
  const apiKey = process.env.URLSCAN_API_KEY;
  if (!apiKey) {
    logger.warn("URLSCAN_API_KEY not set, skipping URLScan submission");
    return { ok: false, error: "no_api_key" };
  }

  let res: Response;
  try {
    res = await fetch("https://urlscan.io/api/v1/scan/", {
      method: "POST",
      headers: {
        "API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        visibility: "unlisted",
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const message = String(err);
    const isTimeout =
      message.includes("AbortError") || message.includes("TimeoutError");
    logger.error("URLScan submission error", { error: message, url });
    return {
      ok: false,
      error: isTimeout ? "timeout" : "network_error",
      message,
    };
  }

  if (!res.ok) {
    // urlscan's API documents 429 for rate limit and 400 for outright
    // refusal (e.g. internal IP, malformed URL, blocked domain). Treat
    // them as distinct so the dashboard can group them.
    let bodyText: string | undefined;
    try {
      bodyText = (await res.text()).slice(0, 500);
    } catch {
      // best-effort body capture — ignore parse failures
    }
    const reason =
      res.status === 429
        ? "rate_limited"
        : res.status === 400
          ? "rejected"
          : "http_error";
    logger.warn("URLScan submission failed", {
      status: res.status,
      reason,
      url,
      body: bodyText,
    });
    return { ok: false, error: reason, status: res.status, message: bodyText };
  }

  const data = (await res.json()) as { uuid: string; api: string };
  return { ok: true, uuid: data.uuid, apiUrl: data.api };
}

/**
 * Retrieve results for a previously submitted scan.
 * Should be called 60+ seconds after submission.
 * Returns null if results aren't ready yet (404).
 *
 * MUST send the API-Key: submissions use `visibility: "unlisted"` (see
 * submitURLScanWithDetails), and urlscan returns 404 from the result API for
 * unlisted scans unless the owning key is presented. Without the header every
 * retrieval 404'd → null, which read as "not ready yet" forever — the root
 * cause of the 100% clone-watch urlscan failure (0/343 retrieved). The scans
 * rendered fine; we just never authenticated the fetch.
 */
export async function retrieveURLScan(uuid: string): Promise<URLScanResult | null> {
  try {
    const apiKey = process.env.URLSCAN_API_KEY;
    const res = await fetch(
      `https://urlscan.io/api/v1/result/${uuid}/`,
      {
        headers: apiKey ? { "API-Key": apiKey } : undefined,
        signal: AbortSignal.timeout(10_000),
      }
    );

    // 404 = scan not yet complete (or unlisted result without a valid key)
    if (res.status === 404) {
      logger.info("URLScan result not ready yet", { uuid });
      return null;
    }

    if (!res.ok) {
      logger.warn("URLScan retrieval failed", { status: res.status, uuid });
      return null;
    }

    const data = await res.json();

    const verdicts = data.verdicts?.overall || {};
    const page = data.page || {};
    const lists = data.lists || {};

    return {
      scanId: uuid,
      screenshotUrl: data.task?.screenshotURL || null,
      effectiveUrl: page.url || data.task?.url || "",
      malicious: verdicts.malicious === true,
      score: verdicts.score ?? 0,
      categories: Array.isArray(verdicts.categories) ? verdicts.categories : [],
      technologies: Array.isArray(lists.technologies)
        ? lists.technologies.map((t: { name?: string }) => t.name || String(t)).slice(0, 20)
        : [],
      serverInfo: {
        ip: page.ip || null,
        country: page.country || null,
        asn: page.asn || null,
      },
      domainAge: null, // URLScan doesn't directly provide this
    };
  } catch (err) {
    logger.error("URLScan retrieval error", { error: String(err), uuid });
    return null;
  }
}

export { EMPTY_RESULT as URLSCAN_EMPTY_RESULT };
