// CT Monitor — every 12h, lightweight Certificate Transparency check for AU brands.
// Supplements the heavy Python crt.sh scraper with more frequent lightweight checks.
// Uses exponential backoff for crt.sh reliability issues.

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { normalizeURL } from "../url-normalize";

const AU_BRAND_KEYWORDS = [
  "mygov",
  "centrelink",
  "ato.gov",
  "auspost",
  "commbank",
  "nab",
  "westpac",
  "telstra",
  "servicensw",
];

const LEGITIMATE_DOMAINS = new Set([
  "my.gov.au",
  "mygov.au",
  "servicesaustralia.gov.au",
  "centrelink.gov.au",
  "ato.gov.au",
  "auspost.com.au",
  "commbank.com.au",
  "nab.com.au",
  "anz.com",
  "anz.com.au",
  "westpac.com.au",
  "telstra.com",
  "telstra.com.au",
  "service.nsw.gov.au",
]);

function isLegitimate(domain: string): boolean {
  const d = domain.toLowerCase().replace(/\.$/, "");
  for (const legit of LEGITIMATE_DOMAINS) {
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
    name: "Pipeline: CT Log Monitor",
  },
  { cron: "0 */12 * * *" }, // Every 12 hours
  async ({ step }) => {
    if (!featureFlags.dataPipeline) {
      return { skipped: true, reason: "dataPipeline feature flag disabled" };
    }

    const newDomains = await step.run("scan-ct-logs", async () => {
      const found: Array<{ url: string; brand: string }> = [];
      const seen = new Set<string>();

      for (const keyword of AU_BRAND_KEYWORDS) {
        const certs = await fetchCrtSh(keyword);

        for (const cert of certs) {
          const cn = cert.common_name?.toLowerCase().trim();
          if (!cn || cn.startsWith("*") || isLegitimate(cn) || seen.has(cn)) continue;
          seen.add(cn);
          found.push({ url: `https://${cn}`, brand: keyword });
        }

        // Rate-limit between keywords
        await new Promise((r) => setTimeout(r, 500));
      }

      return found;
    });

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
      scanned: AU_BRAND_KEYWORDS.length,
      found: newDomains.length,
      inserted: upsertResult.inserted,
    });

    return {
      scanned: AU_BRAND_KEYWORDS.length,
      found: newDomains.length,
      ...upsertResult,
    };
  }
);
