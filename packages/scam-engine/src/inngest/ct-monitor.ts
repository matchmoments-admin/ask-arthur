// CT Monitor — every 12h, lightweight Certificate Transparency check for AU brands.
// Supplements the heavy Python crt.sh scraper with more frequent lightweight checks.
// Uses exponential backoff for crt.sh reliability issues.

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { getCtMonitorConfig } from "@askarthur/shopfront-glue";
import { normalizeURL } from "../url-normalize";
import { withAxiomLogging } from "./with-axiom-logging";

// Keyword set + legitimate-domain exclusions are derived from the single
// source of truth — the AU brand watchlist in @askarthur/shopfront-glue — via
// getCtMonitorConfig. The `core` tier reproduces the original hardcoded
// 9-keyword list exactly; the `expanded` tier (research-driven concentrated AU
// targets) only fires when FF_CT_MONITOR_EXPANDED is ON. See ADR-0016: this
// CT monitor stays a distinct surface from clone-watch (writes
// brand_impersonation_alerts, feeds the consumer extension), but both now read
// the same watchlist so the keyword/legit-domain lists can't drift apart.

function isLegitimate(domain: string, legitimateDomains: Set<string>): boolean {
  const d = domain.toLowerCase().replace(/\.$/, "");
  for (const legit of legitimateDomains) {
    if (d === legit || d.endsWith(`.${legit}`)) return true;
  }
  return false;
}

async function fetchCrtSh(keyword: string): Promise<Array<{ common_name: string }>> {
  const maxRetries = 3;
  const baseDelay = 2000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(
        `https://crt.sh/?q=%25${encodeURIComponent(keyword)}%25&output=json`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (res.ok) return res.json();
      if (res.status >= 500) {
        const delay = baseDelay * 2 ** attempt;
        logger.warn("crt.sh server error, retrying", {
          status: res.status,
          keyword,
          delay,
        });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return [];
    } catch {
      const delay = baseDelay * 2 ** attempt;
      logger.warn("crt.sh request failed, retrying", { keyword, attempt, delay });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  logger.error("crt.sh failed after retries", { keyword });
  return [];
}

export const ctMonitor = inngest.createFunction(
  {
    id: "pipeline-ct-monitor",
    concurrency: { limit: 1 },
    timeouts: { finish: "6m" },
    name: "Pipeline: CT Log Monitor",
  },
  { cron: "0 */12 * * *" }, // Every 12 hours
  withAxiomLogging({ fnId: "pipeline-ct-monitor" }, async ({ step }) => {
    if (!featureFlags.dataPipeline) {
      return { skipped: true, reason: "dataPipeline feature flag disabled" };
    }

    // Derive keywords + exclusions from the shared watchlist. When
    // FF_CT_MONITOR_EXPANDED is OFF this returns exactly the original 9
    // `core` keywords, so the monitor's behaviour is unchanged.
    const { keywords, legitimateDomains } = getCtMonitorConfig(
      featureFlags.ctMonitorExpanded,
    );
    const legitSet = new Set(legitimateDomains);

    // One step.run per keyword (M-ct, cron-hardening #521). Previously all 9
    // crt.sh fetches + their exponential-backoff sleeps lived in a single
    // step, so a slow/flaky keyword forced an Inngest retry to re-scan the
    // ENTIRE keyword set (re-hitting crt.sh). Per-keyword steps are memoised
    // once successful, so a retry only re-runs the keyword that failed, and
    // each step's internal backoff is bounded to that one keyword. Step id is
    // keyed on the stable keyword (deterministic — no replay-loop risk). The
    // inter-keyword setTimeout is dropped: sequential step execution already
    // spaces the calls, and fetchCrtSh handles 5xx backoff internally.
    const perKeyword: Array<Array<{ url: string; brand: string }>> = [];
    for (const { keyword } of keywords) {
      const found = await step.run(`scan-ct-${keyword}`, async () => {
        const certs = await fetchCrtSh(keyword);
        const out: Array<{ url: string; brand: string }> = [];
        for (const cert of certs) {
          const cn = cert.common_name?.toLowerCase().trim();
          if (!cn || cn.startsWith("*") || isLegitimate(cn, legitSet)) continue;
          // Store the keyword as the brand label (unchanged from the original
          // hardcoded behaviour) so downstream brand_impersonation_alerts
          // consumers see byte-identical data for the `core` keywords.
          out.push({ url: `https://${cn}`, brand: keyword });
        }
        return out;
      });
      perKeyword.push(found);
    }

    // Dedup across keywords in plain (deterministic) code, after the steps.
    const seen = new Set<string>();
    const newDomains: Array<{ url: string; brand: string }> = [];
    for (const arr of perKeyword) {
      for (const entry of arr) {
        const cn = entry.url.replace(/^https:\/\//, "");
        if (seen.has(cn)) continue;
        seen.add(cn);
        newDomains.push(entry);
      }
    }

    if (newDomains.length === 0) {
      return { found: 0 };
    }

    // Upsert found domains
    const upsertResult = await step.run("upsert-ct-domains", async () => {
      const supabase = createServiceClient();
      if (!supabase) return { inserted: 0 };

      let inserted = 0;
      for (const entry of newDomains) {
        const norm = normalizeURL(entry.url);
        if (!norm) continue;

        const { error } = await supabase.rpc("bulk_upsert_feed_url", {
          p_normalized_url: norm.normalized,
          p_domain: norm.domain,
          p_subdomain: norm.subdomain,
          p_tld: norm.tld,
          p_full_path: norm.fullPath,
          p_feed_source: "crtsh_monitor",
          p_scam_type: "brand_impersonation",
          p_brand: entry.brand,
        });

        if (!error) inserted++;
      }

      return { inserted };
    });

    logger.info("CT monitor complete", {
      scanned: keywords.length,
      expanded: featureFlags.ctMonitorExpanded,
      found: newDomains.length,
      inserted: upsertResult.inserted,
    });

    return {
      scanned: keywords.length,
      found: newDomains.length,
      ...upsertResult,
    };
  })
);
