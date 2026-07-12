// On-demand URL enrichment — fleet-review item D3 (2026-07-13).
//
// The cron `pipeline-enrichment-fanout` enriches the ~235k feed-imported
// scam_urls backlog newest-first (#723), which will never fully drain. This
// consumer closes the residual gap: when a user actually CHECKS a URL that
// happens to be a still-pending feed row, enrich that specific domain now so
// its WHOIS/SSL intel is ready for the dashboards / threat feed that surface
// URLs people encounter — rather than waiting for the URL to bubble up the
// 5-year backlog (or never, if it's old).
//
// Why a consumer of analyze.completed.v1 (not an analyze-path change): the
// analyze verdict does NOT read scam_urls (verified — the route never queries
// it), so this is purely internal-intel freshness and must NOT add latency to
// the user's check. analyze.completed.v1 already carries urlResults and is
// emitted in prod (FF_ANALYZE_INNGEST_WEB on), so this is a zero-hot-path,
// consumer-only addition. Idempotency-keyed on requestId; only ever touches
// pending/failed rows, so redelivery + the cron overlapping are both benign.

import { inngest } from "./client";
import { withAxiomLogging } from "./with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { lookupWhois } from "../whois";
import { checkSSL } from "../ssl";
import { extractDomain } from "../url-normalize";
import { ANALYZE_COMPLETED_EVENT, parseAnalyzeCompletedData } from "./events";

// Cap domains enriched per checked analysis — a check rarely carries more than
// a couple of URLs, and this bounds the per-event work + WHOIS/SSL fan-out.
const MAX_DOMAINS_PER_CHECK = 5;

/**
 * Unique, extractable domains from a checked analysis's URLs, capped. Pure +
 * unit-tested so the dedup / null-filter / cap can't silently regress.
 */
export function checkedDomains(
  urls: string[],
  cap = MAX_DOMAINS_PER_CHECK,
): string[] {
  return [
    ...new Set(
      urls.map((u) => extractDomain(u)).filter((d): d is string => Boolean(d)),
    ),
  ].slice(0, cap);
}

export const onDemandUrlEnrich = inngest.createFunction(
  {
    id: "on-demand-url-enrich",
    name: "Enrichment: on-demand WHOIS/SSL for checked pending URLs",
    // One enrichment pass per analyze event; redelivery is a no-op (rows are
    // already 'completed' after the first pass).
    idempotency: "event.data.requestId",
    retries: 1,
    concurrency: { limit: 2 },
  },
  { event: ANALYZE_COMPLETED_EVENT },
  withAxiomLogging({ fnId: "on-demand-url-enrich" }, async ({ event, step }) => {
    if (!featureFlags.dataPipeline) {
      return { skipped: true, reason: "dataPipeline flag off" };
    }

    const data = parseAnalyzeCompletedData(event.data);
    const urls = (data.urlResults ?? []).map((r) => r.url);
    if (urls.length === 0) {
      return { skipped: true, reason: "no urls in analysis" };
    }

    const domains = checkedDomains(urls);

    if (domains.length === 0) {
      return { skipped: true, reason: "no extractable domains" };
    }

    // One step.run per domain — memoised on retry, and each domain's WHOIS/SSL
    // failure is isolated from the others.
    let enrichedDomains = 0;
    let enrichedRows = 0;
    for (const domain of domains) {
      const result = await step.run(`enrich-${domain}`, async () => {
        const supabase = createServiceClient();
        if (!supabase) return { rows: 0 };

        // Only pending/failed feed rows for this domain — skip anything the
        // cron already completed. This is the read-gate that keeps the fn a
        // no-op for URLs not in (or already enriched in) scam_urls.
        const { data: rows, error: selErr } = await supabase
          .from("scam_urls")
          .select("id")
          .eq("domain", domain)
          .in("enrichment_status", ["pending", "failed"])
          .eq("is_active", true)
          .limit(200);
        if (selErr) throw new Error(`select scam_urls: ${selErr.message}`);
        const urlIds = (rows ?? []).map((r) => r.id as number);
        if (urlIds.length === 0) return { rows: 0 };

        const [whois, ssl] = await Promise.all([
          lookupWhois(domain),
          checkSSL(domain),
        ]);

        // Mirrors the write shape in enrichment.ts (the cron fan-out). Kept
        // in sync deliberately; both mark enrichment_status='completed'.
        const { error: upErr } = await supabase
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
          .in("id", urlIds);
        if (upErr) {
          logger.warn("on-demand-url-enrich: update failed", {
            domain,
            error: upErr.message,
          });
          return { rows: 0 };
        }
        return { rows: urlIds.length };
      });
      if (result.rows > 0) {
        enrichedDomains++;
        enrichedRows += result.rows;
      }
    }

    logger.info("on-demand-url-enrich: complete", {
      requestId: data.requestId,
      domainsChecked: domains.length,
      enrichedDomains,
      enrichedRows,
    });

    return { domainsChecked: domains.length, enrichedDomains, enrichedRows };
  }),
);
