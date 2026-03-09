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
import { checkCookieSecurity } from "./checks/cookie-security";
import { checkSRI } from "./checks/sri";
import { checkOpenRedirect } from "./checks/open-redirect";
import { checkDNSSEC } from "./checks/dnssec";
import { checkSecurityTxt } from "./checks/security-txt";
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
  FetchError,
  FetchErrorType,
} from "./types";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_TOTAL_TIMEOUT_MS = 15000;
const DEFAULT_USER_AGENT = "AskArthur-SiteAudit/1.0";
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Classify a fetch error into a FetchError type */
function classifyFetchError(err: unknown, statusCode?: number): FetchError {
  if (statusCode === 403 || statusCode === 429 || statusCode === 503) {
    return { type: "blocked", message: `Server returned HTTP ${statusCode}` };
  }

  if (err instanceof Error) {
    if (err.name === "AbortError" || err.message.includes("timeout")) {
      return { type: "timeout", message: "Request timed out" };
    }
    if (err.message.includes("ENOTFOUND") || err.message.includes("getaddrinfo")) {
      return { type: "dns_error", message: "Domain does not resolve" };
    }
    if (
      err.message.includes("CERT_") ||
      err.message.includes("SSL") ||
      err.message.includes("TLS") ||
      err.message.includes("certificate")
    ) {
      return { type: "tls_error", message: err.message };
    }
    return { type: "network_error", message: err.message };
  }

  return { type: "network_error", message: String(err) };
}

/** Attempt a page fetch with the given UA, returning null on blocked status codes */
async function attemptFetch(
  url: string,
  userAgent: string,
  timeoutMs: number
): Promise<{ ok: true; headers: Headers; html: string; finalUrl: string } | { ok: false; error: unknown; statusCode?: number }> {
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

    // Treat 403/429/503 as blocked
    if (res.status === 403 || res.status === 429 || res.status === 503) {
      return { ok: false, error: new Error(`HTTP ${res.status}`), statusCode: res.status };
    }

    const html = await res.text();
    return { ok: true, headers: res.headers, html, finalUrl: res.url };
  } catch (err) {
    return { ok: false, error: err };
  }
}

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

  // 3. Fetch the page — with UA retry strategy
  let headers: Headers | null = null;
  let html = "";
  let finalUrl = url;
  let partial = false;
  let fetchError: FetchError | null = null;

  // Attempt 1: honest UA
  let attempt = await attemptFetch(url, userAgent, timeoutMs);

  // Attempt 2: browser UA if blocked
  if (!attempt.ok && attempt.statusCode && [403, 429, 503].includes(attempt.statusCode)) {
    attempt = await attemptFetch(url, BROWSER_USER_AGENT, timeoutMs);
  }

  if (attempt.ok) {
    headers = attempt.headers;
    html = attempt.html;
    finalUrl = attempt.finalUrl;
  } else {
    // Fetch failed — continue with partial scan
    partial = true;
    fetchError = classifyFetchError(attempt.error, attempt.statusCode);
    logger.warn("Site audit fetch failed, running partial scan", {
      url,
      errorType: fetchError.type,
      message: fetchError.message,
    });
  }

  // Capture raw headers
  const rawHeaders: Record<string, string> | null = headers
    ? (() => {
        const h: Record<string, string> = {};
        headers!.forEach((value, name) => {
          h[name] = value;
        });
        return h;
      })()
    : null;

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

  // Header-based checks — only when we have headers
  if (headers) {
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
    if (!skip.has("cookie-security")) {
      allChecks.push(checkCookieSecurity(headers));
    }
  }

  // HTML-based checks — only when we have HTML
  if (html) {
    if (!skip.has("mixed-content")) {
      allChecks.push(checkMixedContent(html, finalUrl));
    }
    if (!skip.has("sri")) {
      allChecks.push(checkSRI(html, finalUrl));
    }
  }

  // Async checks — TLS/SSL always run (they use raw sockets, not HTTP)
  if (!skip.has("tls-version")) {
    checkPromises.push(
      checkTLSVersions(finalDomain).then((results) => {
        allChecks.push(...results);
      })
    );
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

  // New async checks that don't require page fetch
  if (!skip.has("open-redirect")) {
    checkPromises.push(
      checkOpenRedirect(finalUrl).then((result) => {
        allChecks.push(result);
      })
    );
  }

  if (!skip.has("dnssec")) {
    checkPromises.push(
      checkDNSSEC(domain).then((result) => {
        allChecks.push(result);
      })
    );
  }

  if (!skip.has("security-txt")) {
    checkPromises.push(
      checkSecurityTxt(finalUrl).then((result) => {
        allChecks.push(result);
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
    partial,
    fetchError,
  };
}

/** Event types emitted during streaming scan */
export type ScanEvent =
  | { type: "check"; data: CheckResult }
  | { type: "progress"; data: { phase: string; completed: number; total: number } }
  | { type: "partial"; data: { fetchError: FetchError } }
  | { type: "complete"; data: SiteAuditResult }
  | { type: "error"; data: { message: string } };

/** Run a streaming site audit, emitting events as checks complete */
export async function runSiteAuditStreaming(
  options: ScanOptions,
  emit: (event: ScanEvent) => void
): Promise<void> {
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
    emit({ type: "error", data: { message: "URL points to a private or internal resource." } });
    return;
  }

  // 2. Extract domain
  const domain = extractDomain(url);
  if (!domain) {
    emit({ type: "error", data: { message: "Could not extract domain from URL." } });
    return;
  }

  // 3. Fetch the page with UA retry
  let headers: Headers | null = null;
  let html = "";
  let finalUrl = url;
  let partial = false;
  let fetchError: FetchError | null = null;

  let attempt = await attemptFetch(url, userAgent, timeoutMs);
  if (!attempt.ok && attempt.statusCode && [403, 429, 503].includes(attempt.statusCode)) {
    attempt = await attemptFetch(url, BROWSER_USER_AGENT, timeoutMs);
  }

  if (attempt.ok) {
    headers = attempt.headers;
    html = attempt.html;
    finalUrl = attempt.finalUrl;
  } else {
    partial = true;
    fetchError = classifyFetchError(attempt.error, attempt.statusCode);
    emit({ type: "partial", data: { fetchError } });
  }

  const rawHeaders: Record<string, string> | null = headers
    ? (() => {
        const h: Record<string, string> = {};
        headers!.forEach((value, name) => {
          h[name] = value;
        });
        return h;
      })()
    : null;

  const finalDomain = (() => {
    try {
      return new URL(finalUrl).hostname;
    } catch {
      return domain;
    }
  })();

  const skip = new Set(skipChecks);
  const allChecks: CheckResult[] = [];
  let sslInfo: SSLInfo | null = null;
  let serverInfo: ServerInfo | null = null;
  let redirectChain: RedirectHop[] | null = null;
  let completed = 0;

  // Estimate total checks
  const totalEstimate = 25; // approximate

  function emitCheck(check: CheckResult) {
    allChecks.push(check);
    completed++;
    emit({ type: "check", data: check });
  }

  function emitChecks(checks: CheckResult[]) {
    for (const c of checks) emitCheck(c);
  }

  // Header-based checks (synchronous)
  if (headers) {
    if (!skip.has("security-headers")) emitChecks(checkSecurityHeaders(headers));
    if (!skip.has("csp")) emitChecks(checkCSP(headers));
    if (!skip.has("permissions-policy")) emitCheck(checkPermissionsPolicy(headers));
    if (!skip.has("server-info")) {
      const result = checkServerInfo(headers);
      emitCheck(result.check);
      serverInfo = result.info;
    }
    if (!skip.has("cross-origin")) emitChecks(checkCrossOriginHeaders(headers));
    if (!skip.has("cors")) emitCheck(checkCORS(headers));
    if (!skip.has("cookie-security")) emitCheck(checkCookieSecurity(headers));

    emit({ type: "progress", data: { phase: "headers_done", completed, total: totalEstimate } });
  }

  // HTML-based checks
  if (html) {
    if (!skip.has("mixed-content")) emitCheck(checkMixedContent(html, finalUrl));
    if (!skip.has("sri")) emitCheck(checkSRI(html, finalUrl));
  }

  // Async checks — emit as they complete
  const checkPromises: Array<Promise<void>> = [];

  if (!skip.has("tls-version")) {
    checkPromises.push(
      checkTLSVersions(finalDomain).then((results) => {
        emitChecks(results);
        emit({ type: "progress", data: { phase: "tls_done", completed, total: totalEstimate } });
      })
    );
  }

  if (!skip.has("ssl-certificate")) {
    checkPromises.push(
      checkSSLCertificate(finalDomain, timeoutMs).then(({ check, info }) => {
        emitCheck(check);
        sslInfo = info;
      })
    );
  }

  if (!skip.has("admin-paths")) {
    checkPromises.push(
      checkExposedAdminPaths(finalUrl, timeoutMs).then((result) => emitCheck(result))
    );
  }

  if (!skip.has("email-security")) {
    checkPromises.push(
      checkEmailSecurity(domain).then((results) => {
        emitChecks(results);
        emit({ type: "progress", data: { phase: "email_done", completed, total: totalEstimate } });
      })
    );
  }

  if (!skip.has("domain-blacklist")) {
    checkPromises.push(
      checkDomainBlacklist(domain).then((result) => emitCheck(result))
    );
  }

  if (!skip.has("redirect-chain")) {
    checkPromises.push(
      checkRedirectChain(url, timeoutMs).then(({ check, chain }) => {
        emitCheck(check);
        redirectChain = chain;
      })
    );
  }

  if (!skip.has("open-redirect")) {
    checkPromises.push(
      checkOpenRedirect(finalUrl).then((result) => emitCheck(result))
    );
  }

  if (!skip.has("dnssec")) {
    checkPromises.push(
      checkDNSSEC(domain).then((result) => emitCheck(result))
    );
  }

  if (!skip.has("security-txt")) {
    checkPromises.push(
      checkSecurityTxt(finalUrl).then((result) => emitCheck(result))
    );
  }

  // Wait with total timeout
  const totalTimeout = new Promise<void>((resolve) =>
    setTimeout(resolve, totalTimeoutMs - (Date.now() - start))
  );

  await Promise.race([
    Promise.allSettled(checkPromises),
    totalTimeout,
  ]);

  // Calculate final scores
  const categories = calculateCategoryScores(allChecks);
  const overallScore = calculateScore(categories);
  const grade = calculateGrade(overallScore);
  const recommendations = generateRecommendations(allChecks);
  const durationMs = Date.now() - start;

  const result: SiteAuditResult = {
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
    partial,
    fetchError,
  };

  emit({ type: "complete", data: result });
}
