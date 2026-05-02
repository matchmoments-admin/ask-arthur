// Enrichment fan-out — every 6h, fetches pending URLs, runs WHOIS+SSL per unique domain.
// Capped at 20 domains per run with step.run() parallelism to avoid Edge Function timeouts.
// Copies enrichment data across all same-domain URLs.

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { lookupWhois } from "../whois";
import { checkSSL } from "../ssl";

const MAX_DOMAINS_PER_RUN = 20;

export const enrichmentFanOut = inngest.createFunction(
  {
    id: "pipeline-enrichment-fanout",
    name: "Pipeline: Enrich Pending URLs",
    concurrency: { limit: 1 }, // Only one enrichment run at a time
    // Defence-in-depth against manual re-trigger storms from the Inngest
    // dashboard. The 6h cron already paces itself; rateLimit blocks an
    // analyst from clicking Trigger five times in a minute and fanning out
    // 5×20 WHOIS+SSL lookups on the same domains. Cron-safe because 30m < 6h.
    rateLimit: { limit: 1, period: "30m" },
  },
  { cron: "0 */6 * * *" }, // Every 6 hours
  async ({ step }) => {
    if (!featureFlags.dataPipeline) {
      return { skipped: true, reason: "dataPipeline feature flag disabled" };
    }

    // Step 1: Fetch pending URLs and extract unique domains
    const pendingDomains = await step.run("fetch-pending-domains", async () => {
      const supabase = createServiceClient();
      if (!supabase) return [];

      const { data, error } = await supabase
        .from("scam_urls")
        .select("id, domain")
        .eq("enrichment_status", "pending")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(200); // Fetch more to find unique domains

      if (error) {
        logger.error("Failed to fetch pending URLs", { error: String(error) });
        throw new Error(error.message);
      }

      // Deduplicate by domain, cap at MAX_DOMAINS_PER_RUN
      const domainMap = new Map<string, number[]>();
      for (const row of data || []) {
        const ids = domainMap.get(row.domain) || [];
        ids.push(row.id);
        domainMap.set(row.domain, ids);
      }

      return Array.from(domainMap.entries())
        .slice(0, MAX_DOMAINS_PER_RUN)
        .map(([domain, urlIds]) => ({ domain, urlIds }));
    });

    if (pendingDomains.length === 0) {
      return { enriched: 0, reason: "no pending domains" };
    }

    // Step 2: Fan out WHOIS+SSL per domain using parallel step.run()
    const results = await Promise.all(
      pendingDomains.map((entry) =>
        step.run(`enrich-${entry.domain}`, async () => {
          const [whois, ssl] = await Promise.all([
            lookupWhois(entry.domain),
            checkSSL(entry.domain),
          ]);

          // Update all URLs for this domain
          const supabase = createServiceClient();
          if (!supabase) return { domain: entry.domain, updated: 0 };

          const { error } = await supabase
            .from("scam_urls")
            .update({
              whois_registrar: whois.registrar,
              whois_registrant_country: whois.registrantCountry,
              whois_created_date: whois.createdDate,
              whois_expires_date: whois.expiresDate,
              whois_name_servers: whois.nameServers,
              whois_is_private: whois.isPrivate,
              whois_raw: whois.raw,
              whois_lookup_at: new Date().toISOString(),
              ssl_valid: ssl.valid,
              ssl_issuer: ssl.issuer,
              ssl_days_remaining: ssl.daysRemaining,
              enrichment_status: "completed",
              enrichment_attempted_at: new Date().toISOString(),
            })
            .in("id", entry.urlIds);

          if (error) {
            logger.error("Enrichment update failed", {
              domain: entry.domain,
              error: String(error),
            });
            // Mark as failed so we retry next run
            await supabase
              .from("scam_urls")
              .update({
                enrichment_status: "failed",
                enrichment_attempted_at: new Date().toISOString(),
              })
              .in("id", entry.urlIds);
            return { domain: entry.domain, updated: 0, error: error.message };
          }

          return { domain: entry.domain, updated: entry.urlIds.length };
        })
      )
    );

    const totalUpdated = results.reduce((sum, r) => sum + (r.updated || 0), 0);
    logger.info("Enrichment complete", {
      domains: pendingDomains.length,
      urlsUpdated: totalUpdated,
    });

    return { domains: pendingDomains.length, urlsUpdated: totalUpdated, results };
  }
);
