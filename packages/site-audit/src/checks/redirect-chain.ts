// Redirect chain analysis — follows redirects manually to detect suspicious chains

import type { CheckResult, RedirectHop } from "../types";

const MAX_HOPS = 10;

/** Follow redirects manually and record each hop */
export async function checkRedirectChain(
  url: string,
  timeoutMs: number = 5000
): Promise<{ check: CheckResult; chain: RedirectHop[] }> {
  const chain: RedirectHop[] = [];
  let current = url;

  try {
    for (let i = 0; i < MAX_HOPS; i++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      try {
        res = await fetch(current, {
          method: "GET",
          redirect: "manual",
          headers: { "User-Agent": "AskArthur-SiteAudit/1.0" },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const hop: RedirectHop = {
        url: current,
        statusCode: res.status,
        server: res.headers.get("server") || undefined,
      };

      const location = res.headers.get("location");

      // If it's a redirect (3xx with location), record and follow
      if (res.status >= 300 && res.status < 400 && location) {
        // Resolve relative URLs
        const resolved = new URL(location, current).href;
        hop.location = resolved;
        chain.push(hop);
        current = resolved;
        continue;
      }

      // Final destination reached
      chain.push(hop);
      break;
    }
  } catch (err) {
    // If we fail mid-chain, return what we have
    if (chain.length === 0) {
      return {
        check: {
          id: "redirect-chain",
          category: "content",
          label: "Redirect Chain",
          status: "error",
          score: 0,
          maxScore: 5,
          details: `Failed to follow redirects: ${err instanceof Error ? err.message : String(err)}`,
        },
        chain: [],
      };
    }
  }

  // Count actual redirects (hops - 1 for the final destination)
  const redirectCount = Math.max(0, chain.length - 1);

  // Detect cross-domain redirects
  const hostnames = chain.map((hop) => {
    try {
      return new URL(hop.url).hostname;
    } catch {
      return "";
    }
  });
  const uniqueHosts = new Set(hostnames.filter(Boolean));
  const isCrossDomain = uniqueHosts.size > 1;

  // Scoring logic
  if (redirectCount === 0) {
    return {
      check: {
        id: "redirect-chain",
        category: "content",
        label: "Redirect Chain",
        status: "pass",
        score: 5,
        maxScore: 5,
        details: "No redirects detected — URL resolves directly.",
      },
      chain,
    };
  }

  if (redirectCount <= 1 && !isCrossDomain) {
    return {
      check: {
        id: "redirect-chain",
        category: "content",
        label: "Redirect Chain",
        status: "pass",
        score: 5,
        maxScore: 5,
        details: `${redirectCount} redirect within the same domain.`,
      },
      chain,
    };
  }

  if (redirectCount <= 3 || (redirectCount === 1 && isCrossDomain)) {
    const crossNote = isCrossDomain
      ? ` across ${uniqueHosts.size} domains`
      : "";
    return {
      check: {
        id: "redirect-chain",
        category: "content",
        label: "Redirect Chain",
        status: "warn",
        score: 3,
        maxScore: 5,
        details: `${redirectCount} redirect${redirectCount > 1 ? "s" : ""}${crossNote}. Moderate redirect chain.`,
      },
      chain,
    };
  }

  // 4+ redirects
  const crossNote = isCrossDomain ? ` across ${uniqueHosts.size} domains` : "";
  return {
    check: {
      id: "redirect-chain",
      category: "content",
      label: "Redirect Chain",
      status: "fail",
      score: 0,
      maxScore: 5,
      details: `${redirectCount} redirect${redirectCount > 1 ? "s" : ""}${crossNote}. Excessive redirect chain may indicate suspicious behavior.`,
    },
    chain,
  };
}
