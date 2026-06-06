import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { isFeatureBraked } from "@askarthur/scam-engine/cost-log";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import {
  enrichCloneAttribution,
  type HostingInfo,
} from "@/lib/clone-watch/enrich-attribution";

/**
 * Clone-watch attribution enricher (Phase 2). Builds the per-clone dossier —
 * WHOIS (registrar / created / registrant country), Certificate-Transparency
 * siblings (one operator's campaign), and IP abuse reputation — for confirmed
 * clones, reusing the existing scam-engine helpers.
 *
 * Covers BOTH auto-triaged (#575) and manually-confirmed alerts uniformly via a
 * classification-absence selector (tp_confirmed AND attribution IS NULL),
 * decoupled from how the alert got confirmed. The hosting IP/country/ASN comes
 * from urlscan_evidence.server (already captured); the helpers add the rest.
 *
 * Gated FF_CLONE_WATCH_ATTRIBUTION (default OFF). Brake: the shared
 * shopfront_clone_outreach $5/day cap (helpers are free-tier — whois/CT/geo $0,
 * AbuseIPDB free — so this is cheap; the cap is a backstop). Bounded at
 * ENRICH_RUN_CAP/run; runs daily just after auto-triage.
 */

const BRAKE = "shopfront_clone_outreach";
const ENRICH_RUN_CAP = 15;
const RECENT_WINDOW_DAYS = 14;

interface PendingAlert {
  id: number;
  candidate_domain: string;
  urlscan_evidence: { server?: HostingInfo } | null;
}

export const cloneWatchEnrichAttribution = inngest.createFunction(
  {
    id: "clone-watch-enrich-attribution",
    name: "Clone-watch: attribution dossier enricher",
    timeouts: { finish: "5m" },
    retries: 2,
  },
  { cron: "30 13 * * *" }, // daily, just after auto-triage (13:00 UTC)
  withAxiomLogging({ fnId: "clone-watch-enrich-attribution" }, async ({ step }) => {
    if (!featureFlags.cloneWatchAttribution) {
      return { skipped: true, reason: "FF_CLONE_WATCH_ATTRIBUTION disabled" };
    }

    const braked = await step.run("check-brake", () => isFeatureBraked(BRAKE));
    if (braked) {
      return { skipped: true, reason: `feature_brakes.${BRAKE} engaged` };
    }

    const pending = await step.run("select-pending", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as PendingAlert[];
      const since = new Date(
        Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      const { data, error } = await sb
        .from("shopfront_clone_alerts")
        .select("id, candidate_domain, urlscan_evidence")
        .eq("triage_status", "tp_confirmed")
        .is("attribution", null)
        .gte("first_seen_at", since)
        .order("first_seen_at", { ascending: false })
        .limit(ENRICH_RUN_CAP);
      if (error) {
        logger.error("clone-watch enrich: select failed", {
          error: error.message,
        });
        return [] as PendingAlert[];
      }
      return (data ?? []) as PendingAlert[];
    });

    if (pending.length === 0) {
      return { ok: true, enriched: 0 };
    }

    let enriched = 0;
    for (const alert of pending) {
      const ok = await step.run(`enrich-${alert.id}`, async () => {
        const hosting: HostingInfo = {
          ip: alert.urlscan_evidence?.server?.ip ?? null,
          country: alert.urlscan_evidence?.server?.country ?? null,
          asn: alert.urlscan_evidence?.server?.asn ?? null,
        };
        const dossier = await enrichCloneAttribution(
          alert.candidate_domain,
          hosting,
        );
        const sb = createServiceClient();
        if (!sb) return false;
        const { error } = await sb
          .from("shopfront_clone_alerts")
          .update({ attribution: dossier })
          .eq("id", alert.id);
        if (error) {
          logger.error("clone-watch enrich: update failed", {
            alertId: alert.id,
            error: error.message,
          });
          return false;
        }
        return true;
      });
      if (ok) enriched += 1;
    }

    logger.info("clone-watch enrich: complete", {
      candidates: pending.length,
      enriched,
    });
    return { ok: true, candidates: pending.length, enriched };
  }),
);
