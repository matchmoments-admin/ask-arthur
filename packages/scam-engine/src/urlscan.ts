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
 */
export async function submitURLScan(url: string): Promise<URLScanSubmission | null> {
  const apiKey = process.env.URLSCAN_API_KEY;
  if (!apiKey) {
    logger.warn("URLSCAN_API_KEY not set, skipping URLScan submission");
    return null;
  }

  try {
    const res = await fetch("https://urlscan.io/api/v1/scan/", {
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

    if (!res.ok) {
      logger.warn("URLScan submission failed", { status: res.status, url });
      return null;
    }

    const data = await res.json();
    return {
      uuid: data.uuid,
      apiUrl: data.api,
    };
  } catch (err) {
    logger.error("URLScan submission error", { error: String(err), url });
    return null;
  }
}

/**
 * Retrieve results for a previously submitted scan.
 * Should be called 60+ seconds after submission.
 * Returns null if results aren't ready yet (404).
 */
export async function retrieveURLScan(uuid: string): Promise<URLScanResult | null> {
  try {
    const res = await fetch(
      `https://urlscan.io/api/v1/result/${uuid}/`,
      {
        signal: AbortSignal.timeout(10_000),
      }
    );

    // 404 = scan not yet complete
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
