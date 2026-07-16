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
import { computeCampaignKey } from "@/lib/clone-watch/campaign-fingerprint";
import { searchURLScan } from "@askarthur/scam-engine/urlscan-search";
import { shapeKitSiblings } from "@/lib/clone-watch/kit-pivot";

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
// Bumped 15 → 60: attribution now feeds the monthly Brand Stewardship email,
// which lists registrar + abuse contact for EVERY detected clone (not just
// operator-confirmed ones), so the enricher must keep pace with the full NRD
// detection volume (~30/day). WHOIS/CT/geo are free-tier ($0); the run is still
// brake-capped + bounded by this cap.
const ENRICH_RUN_CAP = 60;
const RECENT_WINDOW_DAYS = 35; // covers a full prior calendar month for the report
// Bounded per-run campaign_key backfill of already-enriched rows (converges to
// zero over a few days; the "insufficient" sentinel keeps it self-draining).
const BACKFILL_CAP = 500;
// urlscan Search API is rate-limited (free tier), so pivot at most this many
// confirmed-phishing clones per run.
const KIT_PIVOT_RUN_CAP = 10;

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
      // Enrich ALL report-eligible NRD clones (was tp_confirmed-only): the
      // Brand Stewardship email now surfaces registrar + abuse contact for
      // every detected clone so brands can action takedowns themselves. Gate
      // on a completed urlscan render (urlscan_scanned_at) so the dossier's
      // hosting block is populated; FP/neutral domains still get enriched
      // because they still appear in the brand's monthly tally.
      const { data, error } = await sb
        .from("shopfront_clone_alerts")
        .select("id, candidate_domain, urlscan_evidence")
        .eq("source", "nrd")
        .not("urlscan_scanned_at", "is", null)
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
        // Stamp the campaign key in the SAME write (zero extra writes). Sentinel
        // "insufficient" for a too-weak fingerprint so the row still crosses the
        // backfill predicate below and is never re-selected.
        const update: { attribution: typeof dossier; campaign_key?: string } = {
          attribution: dossier,
        };
        if (featureFlags.cloneCampaigns) {
          update.campaign_key =
            campaignKeyFromDossier(dossier) ?? "insufficient";
        }
        const { error } = await sb
          .from("shopfront_clone_alerts")
          .update(update)
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

    // Kit pivots: for confirmed likely_phishing clones, search urlscan for
    // other sites on the same hosting IP (a phishing kit deployed repeatedly)
    // and store attribution.kit_siblings. One batched step (no fan-out). Op-
    // review rule: EVERY completed search writes a block — even zero siblings —
    // so the row crosses the `kit_siblings IS NULL` predicate and is never
    // re-searched; a 429 (quota) writes nothing and aborts the batch, leaving
    // rows eligible tomorrow.
    let kitPivoted = 0;
    if (featureFlags.cloneWatchKitPivots && process.env.URLSCAN_API_KEY) {
      kitPivoted = await step.run("kit-pivots", async () => {
        const sb = createServiceClient();
        if (!sb) return 0;
        const since = new Date(
          Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();
        const { data } = await sb
          .from("shopfront_clone_alerts")
          .select("id, candidate_domain, urlscan_evidence, attribution")
          .eq("urlscan_classification", "likely_phishing")
          .not("attribution", "is", null)
          .is("attribution->kit_siblings", null)
          .gte("first_seen_at", since)
          .limit(KIT_PIVOT_RUN_CAP);
        const rows = (data ?? []) as Array<{
          id: number;
          candidate_domain: string;
          urlscan_evidence: { server?: { ip?: string | null } } | null;
          attribution: Record<string, unknown> | null;
        }>;
        let n = 0;
        for (const r of rows) {
          const ip = r.urlscan_evidence?.server?.ip ?? null;
          if (!ip) continue; // no pivot without an IP; leave for a later scan
          const outcome = await searchURLScan(`page.ip:"${ip}"`, 50);
          if (!outcome.ok) {
            if (outcome.error === "rate_limited") break; // quota — stop the run
            continue; // transient — leave the row, retry next tick
          }
          const block = shapeKitSiblings(
            r.candidate_domain,
            ip,
            outcome.results,
          );
          const { error } = await sb
            .from("shopfront_clone_alerts")
            .update({
              attribution: { ...(r.attribution ?? {}), kit_siblings: block },
            })
            .eq("id", r.id);
          if (!error) n += 1;
        }
        return n;
      });
    }

    // Converging backfill: stamp campaign_key on already-enriched rows that
    // predate this feature. Bounded per run; the "insufficient" sentinel means
    // weak-attribution rows also cross the predicate, so it drains to zero over
    // a few days. One batched step (no per-row fan-out).
    let backfilled = 0;
    if (featureFlags.cloneCampaigns) {
      backfilled = await step.run("backfill-campaign-keys", async () => {
        const sb = createServiceClient();
        if (!sb) return 0;
        const { data } = await sb
          .from("shopfront_clone_alerts")
          .select("id, attribution")
          .not("attribution", "is", null)
          .is("campaign_key", null)
          .limit(BACKFILL_CAP);
        const rows = (data ?? []) as Array<{
          id: number;
          attribution: DossierShape | null;
        }>;
        let n = 0;
        for (const r of rows) {
          const key = campaignKeyFromDossier(r.attribution) ?? "insufficient";
          const { error } = await sb
            .from("shopfront_clone_alerts")
            .update({ campaign_key: key })
            .eq("id", r.id);
          if (!error) n += 1;
        }
        return n;
      });
    }

    logger.info("clone-watch enrich: complete", {
      candidates: pending.length,
      enriched,
      backfilled,
      kitPivoted,
    });
    return { ok: true, candidates: pending.length, enriched, backfilled, kitPivoted };
  }),
);

/** Derive the campaign-fingerprint inputs from a stored/fresh attribution
 *  dossier. Tolerant of partial dossiers (returns null → caller stamps the
 *  "insufficient" sentinel). */
type DossierShape = {
  whois?: { registrar?: string | null; nameServers?: string[] | null } | null;
  ct?: { issuer?: string | null } | null;
  hosting?: { asn?: string | null } | null;
};
function campaignKeyFromDossier(d: DossierShape | null): string | null {
  if (!d) return null;
  return computeCampaignKey({
    registrar: d.whois?.registrar ?? null,
    nameServers: d.whois?.nameServers ?? null,
    asn: d.hosting?.asn ?? null,
    ctIssuer: d.ct?.issuer ?? null,
  });
}
