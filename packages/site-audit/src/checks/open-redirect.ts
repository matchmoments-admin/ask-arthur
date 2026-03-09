// Open redirect detection — test common redirect parameters for offsite redirects

import type { CheckResult } from "../types";

const REDIRECT_PARAMS = ["url", "redirect", "next", "return", "returnTo", "redirect_uri", "goto"];
const EVIL_TARGET = "https://evil.example.com";
const REDIRECT_TIMEOUT_MS = 3000;
const MAX_CONCURRENT = 7;

/** Check for open redirect vulnerabilities */
export async function checkOpenRedirect(
  baseUrl: string
): Promise<CheckResult> {
  const openRedirects: string[] = [];

  // Test each param in parallel (capped at MAX_CONCURRENT)
  const tasks = REDIRECT_PARAMS.slice(0, MAX_CONCURRENT).map(async (param) => {
    try {
      const testUrl = new URL(baseUrl);
      testUrl.searchParams.set(param, EVIL_TARGET);

      const res = await fetch(testUrl.href, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(REDIRECT_TIMEOUT_MS),
      });

      // Check if response is a redirect pointing to evil target
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (location) {
          try {
            const redirectHost = new URL(location).hostname;
            if (redirectHost === "evil.example.com") {
              openRedirects.push(param);
            }
          } catch {
            // Relative redirect or invalid URL — not an open redirect to external
          }
        }
      }
    } catch {
      // Timeout or network error — skip
    }
  });

  await Promise.allSettled(tasks);

  if (openRedirects.length > 0) {
    return {
      id: "open-redirect",
      category: "server",
      label: "Open Redirect",
      status: "fail",
      score: 0,
      maxScore: 5,
      details: `Open redirect found via parameter${openRedirects.length !== 1 ? "s" : ""}: ${openRedirects.join(", ")}. Attackers can use this to phish users.`,
    };
  }

  return {
    id: "open-redirect",
    category: "server",
    label: "Open Redirect",
    status: "pass",
    score: 5,
    maxScore: 5,
    details: "No open redirect vulnerabilities detected via common parameters.",
  };
}
