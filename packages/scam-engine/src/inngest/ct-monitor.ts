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
// targets) only fires when FF_CT_MONITOR_EXPANDED is ON. Both tiers read the
// same watchlist so the keyword/legit-domain lists can't drift apart.
//
// EFFECT (corrected 2026-07-12 fleet review): this fn upserts hits into
// `scam_urls` via bulk_upsert_feed_url with feed_source='crtsh_monitor' — it
// does NOT write `brand_impersonation_alerts` (an earlier header + the ADR-0016
// note claimed it did; that was never true of this code).
//
// RETIRE CANDIDATE — the operational review found `crtsh_monitor` on **0
// scam_urls rows all-time**, while the Python crt.sh scraper (feed_source
// 'crtsh') has ~4,970. Two independent reasons it produces nothing: (1) it
// duplicates that comprehensive Python scraper, and (2) crt.sh's JSON endpoint
// 502s this lightweight access pattern (verified during the review), so
// fetchCrtSh exhausts its retries and returns [] every run. The bulk_upsert RPC
// DOES append the source on conflict, so the 0-row result is upstream (nothing
// fetched), not a label bug. Recommend retiring in favour of the Python scraper
// (removal is a founder call — this fn is referenced in ADR-0016). Until then
// the all-empty case is now logged loud (see the zero-cert warn below) so the
// inertness can't hide.

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
    let totalRawCerts = 0;
    for (const { keyword } of keywords) {
      const { found, rawCount } = await step.run(`scan-ct-${keyword}`, async () => {
        const certs = await fetchCrtSh(keyword);
        const out: Array<{ url: string; brand: string }> = [];
        for (const cert of certs) {
          const cn = cert.common_name?.toLowerCase().trim();
          if (!cn || cn.startsWith("*") || isLegitimate(cn, legitSet)) continue;
          // Store the keyword as the brand label (unchanged from the original
          // hardcoded behaviour) so downstream scam_urls consumers see
          // byte-identical data for the `core` keywords.
          out.push({ url: `https://${cn}`, brand: keyword });
        }
        return { found: out, rawCount: certs.length };
      });
      perKeyword.push(found);
      totalRawCerts += rawCount;
    }

    // Loud inertness signal (2026-07-12 fleet review): if crt.sh returned ZERO
    // raw certs across every keyword, the fn cannot possibly write anything —
    // that is the "silently produces nothing" state (crt.sh 502ing this access
    // pattern) which hid a 0-row-all-time fn. Always-ship .warn (bypasses INFO
    // sampling) so it is queryable in Axiom and the retire/fix decision is
    // driven by data, not silence. Distinct from "fetched certs but all were
    // legit/known" — that is a healthy empty run and does NOT warn.
    if (totalRawCerts === 0) {
      logger.warn("pipeline-ct-monitor: crt.sh returned zero certs for all keywords", {
        keywords: keywords.length,
        expanded: featureFlags.ctMonitorExpanded,
        hint: "crt.sh access is failing (502) — this fn is inert; it duplicates the Python crtsh scraper. See retire-candidate note in ct-monitor.ts.",
      });
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
