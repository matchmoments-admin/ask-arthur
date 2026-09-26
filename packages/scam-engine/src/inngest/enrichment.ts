// Enrichment fan-out — every 12h, fetches pending URLs, runs WHOIS+SSL per unique domain.
// Capped at 20 domains per run. Copies enrichment data across all same-domain URLs.
//
// One batch step, not 20 per-domain steps (v308/#1156). The per-domain
// `step.run` fan-out cost a slot-queue wait at every boundary — 21 boundaries
// on the 5-slot account measured 12 m 45 s trigger→finish for ~25 s of actual
// lookups (whois caps at 5 s, ssl at 3 s, neither throws), and 8 of 18 runs
// were cancelled at the 13 m finish with no retry and no telemetry. The
// lookups now run 4 at a time inside ONE in-step budget; a domain whose write
// fails is stamped `failed` so it never re-presents at the head of the
// newest-first worklist (worklist-gate-starvation-rule).
//
// Ordering (2026-07-12 fleet review): NEWEST-first. The pending-active queue is
// ~235k rows, ALL source_type='feed' (blocklist imports — phishing_army,
// phishtank, etc.), draining at ~20 domains × 2 runs/day = ~40 domains/day. It
// will NOT fully drain, and that is fine: the point of WHOIS/SSL enrichment is
// to have metadata ready when a user checks a *currently-circulating* URL, and
// fresh feed entries are the ones most likely to be checked soon. The original
// oldest-first order meant today's ingested threats waited behind a 2-month-old
// backlog and were effectively never enriched — the exact "recent URLs never
// reached" harm the review flagged. Newest-first (a reverse scan on the existing
// idx_scam_urls_enrichment_queue partial index — no new index) enriches the
// freshest threats promptly; the stale tail is deprioritised and is shed
// naturally by the staleness cron (is_active→false drops rows from this queue).
// The old header's "self-draining … no domains skipped" claim was false.

import { inngest } from "./client";
import { withAxiomLogging } from "./with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { lookupWhois } from "../whois";
import { checkSSL } from "../ssl";
import { budgetedStep } from "./step-budget";

const MAX_DOMAINS_PER_RUN = 20;
const LOOKUP_PARALLELISM = 4;
// In-step: 20 domains / 4-wide × ≤5 s per wave ≈ 25 s; 150 s leaves room for
// slow registries. Checked between waves; an unprocessed tail stays `pending`
// and is picked up next run. Floor = 2 × 30 s + 150 s + 60 s = 270 s < 5 m.
const ENRICH_WALL_CLOCK_MS = 150_000;

interface EnrichOutcome {
  domain: string;
  updated: number;
  error?: string;
  skipped?: "budget_expired";
}

async function enrichDomain(entry: {
  domain: string;
  urlIds: number[];
}): Promise<EnrichOutcome> {
  const supabase = createServiceClient();
  if (!supabase) return { domain: entry.domain, updated: 0 };
  const attemptedAt = new Date().toISOString();
  try {
    const [whois, ssl] = await Promise.all([
      lookupWhois(entry.domain, { priority: "batch" }),
      checkSSL(entry.domain),
    ]);

    // Update all URLs for this domain
    const { error } = await supabase
      .from("scam_urls")
      .update({
        // #1253: an unanswered lookup (quota guard / non-200 / no key) writes
        // no whois_* columns — not nulls over existing values, and no
        // whois_lookup_at, which whois-cached.ts and /api/scam-urls/report
        // read as "this domain has WHOIS data". The row is still marked
        // completed (no re-offer for scam_urls yet — see #1253's PR).
        ...(whois.deferral
          ? {}
          : {
              whois_registrar: whois.registrar,
              whois_registrant_country: whois.registrantCountry,
              whois_created_date: whois.createdDate,
              whois_expires_date: whois.expiresDate,
              whois_name_servers: whois.nameServers,
              whois_is_private: whois.isPrivate,
              whois_raw: whois.raw,
              whois_lookup_at: attemptedAt,
            }),
        ssl_valid: ssl.valid,
        ssl_issuer: ssl.issuer,
        ssl_days_remaining: ssl.daysRemaining,
        enrichment_status: "completed",
        enrichment_attempted_at: attemptedAt,
      })
      .in("id", entry.urlIds);
    if (error) throw new Error(error.message);
    return { domain: entry.domain, updated: entry.urlIds.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Enrichment update failed", {
      domain: entry.domain,
      error: message,
    });
    // Stamp as failed so the row leaves the pending worklist rather than
    // re-presenting at the head every run.
    await supabase
      .from("scam_urls")
      .update({
        enrichment_status: "failed",
        enrichment_attempted_at: attemptedAt,
      })
      .in("id", entry.urlIds);
    return { domain: entry.domain, updated: 0, error: message };
  }
}

export const enrichmentFanOut = inngest.createFunction(
  {
    id: "pipeline-enrichment-fanout",
    // 5m, was 13m: the budget is derived from 2 boundaries + the in-step
    // wall clock (inngestFinishBudgets.test.ts), not from the old 21-step fan-out.
    timeouts: { finish: "5m" },
    name: "Pipeline: Enrich Pending URLs",
    concurrency: { limit: 1 }, // Only one enrichment run at a time
    // Defence-in-depth against manual re-trigger storms from the Inngest
    // dashboard. The 6h cron already paces itself; rateLimit blocks an
    // analyst from clicking Trigger five times in a minute and fanning out
    // 5×20 WHOIS+SSL lookups on the same domains. Cron-safe because 30m < 6h.
    rateLimit: { limit: 1, period: "30m" },
  },
  { cron: "35 */12 * * *" }, // Every 12h at :35 (off the :00 pileup, v308). Capped per run (MAX_DOMAINS_PER_RUN); the ~235k feed backlog exceeds throughput by orders of magnitude, so ordering (newest-first, see header) — not cadence — is what determines which URLs get enriched.
  withAxiomLogging({ fnId: "pipeline-enrichment-fanout" }, async ({ step }) => {
    if (!featureFlags.dataPipeline) {
      return { skipped: true, reason: "dataPipeline feature flag disabled" };
    }

    // Step 1: Fetch pending URLs (newest-first) and extract unique domains.
    // Also read the total pending backlog so its size is observable (the queue
    // vastly exceeds per-run throughput; surface it rather than let it hide).
    const { domains: pendingDomains, backlog } = await step.run(
      "fetch-pending-domains",
      async () => {
        const supabase = createServiceClient();
        if (!supabase) return { domains: [], backlog: 0 };

        const { data, error, count } = await supabase
          .from("scam_urls")
          .select("id, domain", { count: "exact" })
          .eq("enrichment_status", "pending")
          .eq("is_active", true)
          .order("created_at", { ascending: false }) // newest-first (see header)
          .limit(200); // Fetch more to find unique domains

        if (error) {
          logger.error("Failed to fetch pending URLs", {
            error: String(error),
          });
          throw new Error(error.message);
        }

        // Deduplicate by domain, cap at MAX_DOMAINS_PER_RUN
        const domainMap = new Map<string, number[]>();
        for (const row of data || []) {
          const ids = domainMap.get(row.domain) || [];
          ids.push(row.id);
          domainMap.set(row.domain, ids);
        }

        return {
          domains: Array.from(domainMap.entries())
            .slice(0, MAX_DOMAINS_PER_RUN)
            .map(([domain, urlIds]) => ({ domain, urlIds })),
          backlog: count ?? 0,
        };
      },
    );

    // Backlog gauge (INFO, not always-ship .warn). The backlog is structurally
    // ~all source_type='feed' blocklist dumps and, by the newest-first design,
    // NEVER drains below a few thousand — so `backlog > 5000` is a permanent,
    // by-design condition, not an incident. An always-ship .warn firing on it
    // every run would violate the CLAUDE.md rule reserving .warn for RARE
    // high-value events (it burns the always-ship channel and buries a later
    // genuinely-actionable enrichment fault under twice-daily noise — the exact
    // alert-fatigue anti-pattern). INFO keeps the ceiling queryable in Axiom for
    // the enrich-what-users-check scoping decision without paging on a
    // permanent state. The raw backlog is also directly queryable from scam_urls.
    if (backlog > 5000) {
      logger.info(
        "pipeline-enrichment-fanout: pending backlog far exceeds throughput",
        {
          backlog,
          perRunCap: MAX_DOMAINS_PER_RUN,
          hint: "queue is ~all source_type='feed' (blocklist dumps); newest-first enriches fresh threats, stale tail sheds via staleness. Permanent by design — on-demand enrichment (D3) covers user-checked URLs.",
        },
      );
    }

    if (pendingDomains.length === 0) {
      return { enriched: 0, reason: "no pending domains" };
    }

    // Step 2: WHOIS+SSL per domain, LOOKUP_PARALLELISM-wide waves inside one
    // budgeted step (see header).
    const results = await budgetedStep(
      step,
      "enrich-domains",
      ENRICH_WALL_CLOCK_MS,
      async (budget) => {
        const out: EnrichOutcome[] = [];
        for (let i = 0; i < pendingDomains.length; i += LOOKUP_PARALLELISM) {
          if (budget.expired()) {
            // Remaining rows stay `pending` and re-present next run — the
            // worklist is newest-first so they are not starved by the tail.
            out.push(
              ...pendingDomains.slice(i).map((e) => ({
                domain: e.domain,
                updated: 0,
                skipped: "budget_expired" as const,
              })),
            );
            break;
          }
          const wave = pendingDomains.slice(i, i + LOOKUP_PARALLELISM);
          out.push(...(await Promise.all(wave.map(enrichDomain))));
        }
        return out;
      },
    );

    const totalUpdated = results.reduce((sum, r) => sum + (r.updated || 0), 0);
    logger.info("Enrichment complete", {
      domains: pendingDomains.length,
      urlsUpdated: totalUpdated,
    });

    return {
      domains: pendingDomains.length,
      urlsUpdated: totalUpdated,
      results,
    };
  }),
);
