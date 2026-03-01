// Site audit scanner orchestrator — runs all checks via Promise.allSettled

import { isPrivateURL } from "@askarthur/scam-engine/safebrowsing";
import { extractDomain } from "@askarthur/scam-engine/url-normalize";
import { logger } from "@askarthur/utils/logger";
import { checkSecurityHeaders } from "./checks/security-headers";
import { checkCrossOriginHeaders } from "./checks/cross-origin";
import { checkCORS } from "./checks/cors";
import { checkCSP } from "./checks/csp";
import { checkPermissionsPolicy } from "./checks/permissions-policy";
import { checkTLSVersions } from "./checks/tls-version";
import { checkMixedContent } from "./checks/mixed-content";
import { checkExposedAdminPaths } from "./checks/admin-paths";
import { checkServerInfo } from "./checks/server-info";
import { checkSSLCertificate } from "./checks/ssl-certificate";
import { checkEmailSecurity } from "./checks/email-security";
import { checkDomainBlacklist } from "./checks/domain-blacklist";
import { checkRedirectChain } from "./checks/redirect-chain";
import {
  calculateCategoryScores,
  calculateScore,
  calculateGrade,
  generateRecommendations,
} from "./scoring";
import type {
  SiteAuditResult,
  ScanOptions,
  CheckResult,
  SSLInfo,
  ServerInfo,
  RedirectHop,
} from "./types";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_TOTAL_TIMEOUT_MS = 15000;
const DEFAULT_USER_AGENT = "AskArthur-SiteAudit/1.0";

/** Run a full site audit on the given URL */
export async function runSiteAudit(options: ScanOptions): Promise<SiteAuditResult> {
  const start = Date.now();
  const {
    url,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS,
    userAgent = DEFAULT_USER_AGENT,
    skipChecks = [],
  } = options;

  // 1. SSRF protection
  if (isPrivateURL(url)) {
    throw new Error("URL points to a private or internal resource.");
  }

  // 2. Extract domain
  const domain = extractDomain(url);
  if (!domain) {
    throw new Error("Could not extract domain from URL.");
  }

  // 3. Fetch the page
  let headers: Headers;
  let html = "";
  let finalUrl = url;

  try {
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": userAgent },
      signal: controller.signal,
    });

    clearTimeout(fetchTimeout);
    headers = res.headers;
    finalUrl = res.url;
    html = await res.text();
  } catch (err) {
    throw new Error(`Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Capture raw headers
  const rawHeaders: Record<string, string> = {};
  headers.forEach((value, name) => {
    rawHeaders[name] = value;
  });

  // Extract the hostname from the final URL (after redirects)
  const finalDomain = (() => {
    try {
      return new URL(finalUrl).hostname;
    } catch {
      return domain;
    }
  })();

  // 4. Run all checks in parallel via Promise.allSettled
  const skip = new Set(skipChecks);
  const allChecks: CheckResult[] = [];
  let sslInfo: SSLInfo | null = null;
  let serverInfo: ServerInfo | null = null;
  let redirectChain: RedirectHop[] | null = null;

  // Create a total timeout that aborts remaining work
  const totalTimeout = new Promise<void>((resolve) =>
    setTimeout(resolve, totalTimeoutMs - (Date.now() - start))
  );

  const checkPromises: Array<Promise<void>> = [];

  // Header-based checks (synchronous, just parsing)
  if (!skip.has("security-headers")) {
    allChecks.push(...checkSecurityHeaders(headers));
  }
  if (!skip.has("csp")) {
    allChecks.push(...checkCSP(headers));
  }
  if (!skip.has("permissions-policy")) {
    allChecks.push(checkPermissionsPolicy(headers));
  }
  if (!skip.has("server-info")) {
    const result = checkServerInfo(headers);
    allChecks.push(result.check);
    serverInfo = result.info;
  }
  if (!skip.has("cross-origin")) {
    allChecks.push(...checkCrossOriginHeaders(headers));
  }
  if (!skip.has("cors")) {
    allChecks.push(checkCORS(headers));
  }

  // Async checks
  if (!skip.has("tls-version")) {
    checkPromises.push(
      checkTLSVersions(finalDomain).then((results) => {
        allChecks.push(...results);
      })
    );
  }

  if (!skip.has("mixed-content")) {
    // Synchronous but can be deferred
    allChecks.push(checkMixedContent(html, finalUrl));
  }

  if (!skip.has("admin-paths")) {
    checkPromises.push(
      checkExposedAdminPaths(finalUrl, timeoutMs).then((result) => {
        allChecks.push(result);
      })
    );
  }

  if (!skip.has("ssl-certificate")) {
    checkPromises.push(
      checkSSLCertificate(finalDomain, timeoutMs).then(({ check, info }) => {
        allChecks.push(check);
        sslInfo = info;
      })
    );
  }

  if (!skip.has("email-security")) {
    checkPromises.push(
      checkEmailSecurity(domain).then((results) => {
        allChecks.push(...results);
      })
    );
  }

  if (!skip.has("domain-blacklist")) {
    checkPromises.push(
      checkDomainBlacklist(domain).then((result) => {
        allChecks.push(result);
      })
    );
  }

  if (!skip.has("redirect-chain")) {
    checkPromises.push(
      checkRedirectChain(url, timeoutMs).then(({ check, chain }) => {
        allChecks.push(check);
        redirectChain = chain;
      })
    );
  }

  // Wait for async checks with total timeout
  await Promise.race([
    Promise.allSettled(checkPromises),
    totalTimeout,
  ]);

  // 5. Log any check failures for debugging
  for (const check of allChecks) {
    if (check.status === "error") {
      logger.warn("Site audit check error", { id: check.id, details: check.details });
    }
  }

  // 6. Calculate scores and grade
  const categories = calculateCategoryScores(allChecks);
  const overallScore = calculateScore(categories);
  const grade = calculateGrade(overallScore);
  const recommendations = generateRecommendations(allChecks);

  const durationMs = Date.now() - start;

  return {
    url: finalUrl,
    domain,
    scannedAt: new Date().toISOString(),
    durationMs,
    overallScore,
    grade,
    categories,
    checks: allChecks,
    recommendations,
    ssl: sslInfo,
    serverInfo,
    redirectChain,
    rawHeaders,
  };
}
