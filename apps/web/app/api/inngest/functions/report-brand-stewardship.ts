import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { brandNormalize } from "@askarthur/shopfront-glue";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";

/**
 * Monthly Brand Stewardship Report — aggregation + ledger (WS2-cap).
 *
 * Runs on the 1st of each month, aggregates the PRIOR calendar month's
 * onward_report_log (joined to scam_reports for the impersonated brand) and
 * UPSERTs one brand_stewardship_reports row per brand that (a) had ≥1 onward
 * report actually sent on its behalf AND (b) has an active known_brands email
 * contact. The row is the proof-ledger; the brand-facing summary email is a
 * separate admin-approved send step (mirrors clone-watch notify-brand).
 *
 * Aggregation is done in TypeScript (a month of onward_report_log is bounded),
 * which keeps the SQL surface to a lean table — no PL/pgSQL RPC, no
 * search_path/variable_conflict gotchas, no preview-branch smoke-test dance.
 *
 * Gated by FF_BRAND_STEWARDSHIP_REPORT (default OFF). When OFF the cron
 * no-ops, so no rows are prepared and (downstream) no emails are sent.
 *
 * Honesty: we only count onward reports we actually SENT (status='sent') and
 * never claim takedowns — these destinations (OpenPhish/APWG/ACMA) are
 * fire-and-forget email intakes with no takedown callback.
 */

const ONWARD_LOG_FETCH_LIMIT = 5000;

interface OnwardLogRow {
  scam_report_id: number;
  destination: string;
  status: string;
}

export interface BrandMetrics {
  detected: number;
  reportedByDestination: Record<string, number>;
  reportsSent: number;
  scamReportIds: number[];
}

interface KnownBrandContact {
  brand_key: string | null;
  brand_name: string;
  /** known_brands.brand_domain — the clone-side join key (optional so existing
   *  onward-only test fixtures stay valid). */
  brand_domain?: string | null;
  security_contact_email: string | null;
}

/**
 * Derive the canonical brand_key from a free-text brand name, matching the
 * SQL convention in get_onward_destinations (v119):
 *   lower(regexp_replace(brand, '[^a-zA-Z0-9]+', '_', 'g'))
 */
export function deriveBrandKey(brand: string): string {
  return brand.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}

/**
 * Aggregate SENT onward reports by impersonated brand. Only status='sent'
 * rows count as "reported" — we never claim a report we didn't actually make.
 */
export function aggregateOnwardByBrand(
  rows: OnwardLogRow[],
  brandByReportId: Map<number, string>,
): Map<string, BrandMetrics> {
  const out = new Map<string, BrandMetrics>();
  // Track distinct scam_report_ids per brand so `detected` isn't inflated by
  // multiple destinations reporting the same scam.
  const seenIds = new Map<string, Set<number>>();

  for (const row of rows) {
    if (row.status !== "sent") continue;
    const brand = brandByReportId.get(row.scam_report_id);
    if (!brand) continue;

    let m = out.get(brand);
    if (!m) {
      m = {
        detected: 0,
        reportedByDestination: {},
        reportsSent: 0,
        scamReportIds: [],
      };
      out.set(brand, m);
      seenIds.set(brand, new Set());
    }
    m.reportsSent += 1;
    m.reportedByDestination[row.destination] =
      (m.reportedByDestination[row.destination] ?? 0) + 1;

    const ids = seenIds.get(brand)!;
    if (!ids.has(row.scam_report_id)) {
      ids.add(row.scam_report_id);
      m.scamReportIds.push(row.scam_report_id);
    }
  }

  for (const [brand, m] of out) {
    m.detected = seenIds.get(brand)!.size;
  }
  return out;
}

/**
 * Match an aggregated brand string to an active known_brands email contact.
 *
 * Two passes:
 *  1. Direct — exact brand_key or lowercased brand_name match (original v166
 *     behaviour, unchanged).
 *  2. Canonical-equivalence — resolve BOTH the report's free-text brand and
 *     each contact's name to the canonical brand via the brand_aliases layer
 *     (v174) and match on that. This is what lets a scam_report impersonating
 *     "National Australia Bank" reach the known_brands contact stored as "NAB".
 *     `resolveCanonical` is optional so existing callers/tests are unaffected.
 */
export function matchKnownBrand(
  brand: string,
  contacts: KnownBrandContact[],
  resolveCanonical?: (s: string) => string | null,
): KnownBrandContact | null {
  const key = deriveBrandKey(brand);
  const lowerBrand = brand.toLowerCase();
  for (const c of contacts) {
    if (!c.security_contact_email) continue;
    if (
      (c.brand_key && c.brand_key.toLowerCase() === key) ||
      c.brand_name.toLowerCase() === lowerBrand
    ) {
      return c;
    }
  }
  if (resolveCanonical) {
    const canon = resolveCanonical(brand)?.toLowerCase() ?? null;
    if (canon) {
      for (const c of contacts) {
        if (!c.security_contact_email) continue;
        if (resolveCanonical(c.brand_name)?.toLowerCase() === canon) return c;
      }
    }
  }
  return null;
}

/** First day of the prior calendar month (UTC) given a reference date. */
export function priorMonthStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0),
  );
}

// ── Clone-watch detections (the lookalike-domain + hosting/registrar source) ──

const CLONE_FETCH_LIMIT = 3000;
const CLONE_DETAIL_CAP = 25; // per-brand detail rows carried into the email

export interface CloneAlertRow {
  id: number;
  candidate_domain: string;
  inferred_target_domain: string | null;
  urlscan_classification: string | null;
  urlscan_evidence: { server?: { ip?: string; asn?: string; country?: string } } | null;
  attribution: {
    whois?: { registrar?: string; registrarAbuseEmail?: string };
    hosting?: { ip?: string; asn?: string; country?: string };
  } | null;
}

export interface CloneDetail {
  domain: string;
  classification: string | null;
  ip: string | null;
  asn: string | null;
  country: string | null;
  registrar: string | null;
  abuse_email: string | null;
}

export interface CloneBrandMetrics {
  detected: number;
  byClassification: Record<string, number>;
  /** Consumable analytics — counts across ALL deduped clones (not just the
   *  capped detail list), so the email's breakdown bars reflect the full set. */
  byCountry: Record<string, number>;
  byRegistrar: Record<string, number>;
  byAsn: Record<string, number>;
  domains: CloneDetail[];
  alertIds: number[];
}

/** Bucket a nullable dimension value, folding empties into "Unknown". */
function bump(map: Record<string, number>, value: string | null | undefined): void {
  const key = value && value.trim() ? value.trim() : "Unknown";
  map[key] = (map[key] ?? 0) + 1;
}

function toCloneDetail(row: CloneAlertRow): CloneDetail {
  const server = row.urlscan_evidence?.server ?? {};
  // Fall back to the attribution dossier's hosting block when the live urlscan
  // render didn't capture server info (e.g. a clone enriched before its scan
  // completed). Belt-and-suspenders so a clone shows whatever hosting we have.
  const attrHosting = row.attribution?.hosting ?? {};
  const whois = row.attribution?.whois ?? {};
  return {
    domain: row.candidate_domain,
    classification: row.urlscan_classification ?? null,
    ip: server.ip ?? attrHosting.ip ?? null,
    asn: server.asn ?? attrHosting.asn ?? null,
    country: server.country ?? attrHosting.country ?? null,
    registrar: whois.registrar ?? null,
    abuse_email: whois.registrarAbuseEmail ?? null,
  };
}

// Order detail rows so the most actionable (likely_phishing) surface first.
const CLONE_CLASS_RANK: Record<string, number> = {
  likely_phishing: 0,
  parked_for_sale: 1,
  unresolved: 2,
  neutral: 3,
};

/**
 * Group clone-watch alerts by the impersonated brand's domain
 * (inferred_target_domain). Dedupes by candidate_domain, counts by
 * classification, and caps the per-brand detail list. Pure + unit-tested.
 */
export function aggregateClonesByDomain(
  rows: CloneAlertRow[],
): Map<string, CloneBrandMetrics> {
  const out = new Map<string, CloneBrandMetrics>();
  const seenDomain = new Map<string, Set<string>>();

  for (const row of rows) {
    const brandDomain = row.inferred_target_domain?.trim().toLowerCase();
    if (!brandDomain || !row.candidate_domain) continue;

    let m = out.get(brandDomain);
    if (!m) {
      m = {
        detected: 0,
        byClassification: {},
        byCountry: {},
        byRegistrar: {},
        byAsn: {},
        domains: [],
        alertIds: [],
      };
      out.set(brandDomain, m);
      seenDomain.set(brandDomain, new Set());
    }
    const seen = seenDomain.get(brandDomain)!;
    if (seen.has(row.candidate_domain)) continue; // dedupe same clone domain
    seen.add(row.candidate_domain);

    m.detected += 1;
    m.alertIds.push(row.id);
    const cls = row.urlscan_classification ?? "unclassified";
    m.byClassification[cls] = (m.byClassification[cls] ?? 0) + 1;
    const detail = toCloneDetail(row);
    bump(m.byCountry, detail.country);
    bump(m.byRegistrar, detail.registrar);
    bump(m.byAsn, detail.asn);
    m.domains.push(detail);
  }

  // Sort + cap each brand's detail list (most actionable first).
  for (const m of out.values()) {
    m.domains.sort((a, b) => {
      const ra = CLONE_CLASS_RANK[a.classification ?? ""] ?? 9;
      const rb = CLONE_CLASS_RANK[b.classification ?? ""] ?? 9;
      return ra !== rb ? ra - rb : a.domain.localeCompare(b.domain);
    });
    m.domains = m.domains.slice(0, CLONE_DETAIL_CAP);
  }
  return out;
}

export const reportBrandStewardship = inngest.createFunction(
  {
    id: "report-brand-stewardship",
    timeouts: { finish: "4m" },
    name: "Brand Stewardship: monthly report aggregation",
    retries: 2,
  },
  [
    { cron: "0 9 1 * *" }, // 1st of month, 09:00 UTC
    // Manual re-run (ops / pre-launch shadow review). Optional event.data.
    // periodMonth ("YYYY-MM-01") overrides the window — e.g. to prepare the
    // CURRENT month for a review before the scheduled 1st-of-month run.
    { event: "report/brand-stewardship.manual-trigger.v1" },
  ],
  withAxiomLogging({ fnId: "report-brand-stewardship" }, async ({ event, step }) => {
    if (!featureFlags.brandStewardshipReport) {
      return { skipped: true, reason: "FF_BRAND_STEWARDSHIP_REPORT disabled" };
    }

    const periodOverride = (
      event?.data as { periodMonth?: string } | undefined
    )?.periodMonth;

    // Compute the reporting window inside a step so it's memoised across
    // Inngest replays (deterministic). Defaults to the prior calendar month;
    // a manual periodMonth override targets a specific month.
    const period = await step.run("compute-period", async () => {
      const start = periodOverride
        ? new Date(`${periodOverride}T00:00:00Z`)
        : priorMonthStart(new Date());
      const end = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
      );
      return { startIso: start.toISOString(), endIso: end.toISOString() };
    });
    const periodMonth = period.startIso.slice(0, 10); // YYYY-MM-01

    const logRows = await step.run("fetch-onward-log", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as OnwardLogRow[];
      const { data, error } = await sb
        .from("onward_report_log")
        .select("scam_report_id, destination, status")
        .eq("status", "sent")
        .gte("sent_at", period.startIso)
        .lt("sent_at", period.endIso)
        .not("scam_report_id", "is", null)
        .limit(ONWARD_LOG_FETCH_LIMIT);
      if (error) {
        logger.error("brand-stewardship: onward log fetch failed", {
          error: error.message,
        });
        return [] as OnwardLogRow[];
      }
      if ((data?.length ?? 0) === ONWARD_LOG_FETCH_LIMIT) {
        logger.warn("brand-stewardship: onward log fetch hit LIMIT", {
          limit: ONWARD_LOG_FETCH_LIMIT,
          period: periodMonth,
        });
      }
      return (data ?? []) as OnwardLogRow[];
    });

    // NOTE: do NOT early-return on empty onward log — a brand can have clone
    // detections this period without any onward report having been sent.

    // Resolve impersonated brand for each referenced scam_report.
    const brandByReportId = await step.run("resolve-brands", async () => {
      const sb = createServiceClient();
      if (!sb) return {} as Record<string, string>;
      const ids = [...new Set(logRows.map((r) => r.scam_report_id))];
      const map: Record<string, string> = {};
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const { data } = await sb
          .from("scam_reports")
          .select("id, impersonated_brand")
          .in("id", chunk);
        for (const row of data ?? []) {
          const brand = (row.impersonated_brand as string | null)?.trim();
          if (brand) map[String(row.id)] = brand;
        }
      }
      return map;
    });

    const brandMap = new Map<number, string>(
      Object.entries(brandByReportId).map(([k, v]) => [Number(k), v]),
    );
    const aggregated = aggregateOnwardByBrand(logRows, brandMap);

    // Clone-watch lookalike detections for the period — the lookalike-domain +
    // hosting/registrar source. Keyed by the impersonated brand's domain.
    const cloneRows = await step.run("fetch-clone-detections", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as CloneAlertRow[];
      const { data, error } = await sb
        .from("shopfront_clone_alerts")
        .select(
          "id, candidate_domain, inferred_target_domain, urlscan_classification, urlscan_evidence, attribution",
        )
        .eq("source", "nrd")
        .gte("first_seen_at", period.startIso)
        .lt("first_seen_at", period.endIso)
        .not("inferred_target_domain", "is", null)
        .limit(CLONE_FETCH_LIMIT);
      if (error) {
        logger.error("brand-stewardship: clone fetch failed", {
          error: error.message,
        });
        return [] as CloneAlertRow[];
      }
      if ((data?.length ?? 0) === CLONE_FETCH_LIMIT) {
        logger.warn("brand-stewardship: clone fetch hit LIMIT", {
          limit: CLONE_FETCH_LIMIT,
          period: periodMonth,
        });
      }
      return (data ?? []) as unknown as CloneAlertRow[];
    });
    const cloneAgg = aggregateClonesByDomain(cloneRows);

    if (aggregated.size === 0 && cloneAgg.size === 0) {
      return { ok: true, period: periodMonth, brands: 0 };
    }

    // Load active known_brands email contacts; only brands with a contact get
    // a report row (per the contact-gated scope decision).
    const contacts = await step.run("load-contacts", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as KnownBrandContact[];
      const { data } = await sb
        .from("known_brands")
        .select("brand_key, brand_name, brand_domain, security_contact_email")
        .eq("is_active", true)
        .eq("contact_type", "email")
        .not("security_contact_email", "is", null);
      return (data ?? []) as KnownBrandContact[];
    });

    // Canonical brand-alias layer (v174): load alias_normalized -> canonical so
    // a free-text impersonated_brand can be matched to a known_brands contact
    // even when the strings differ ("National Australia Bank" -> "NAB"). Step
    // returns a plain Record (Map doesn't survive Inngest's JSON serialisation);
    // the Map + resolver closure are built outside the step.
    const aliasPairs = await step.run("load-brand-aliases", async () => {
      const sb = createServiceClient();
      if (!sb) return {} as Record<string, string>;
      const map: Record<string, string> = {};
      // 231 rows today; page defensively in case the layer grows.
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb
          .from("brand_aliases")
          .select("alias_normalized, canonical_brand")
          .range(from, from + 999);
        if (error) {
          logger.error("brand-stewardship: brand_aliases load failed", {
            error: error.message,
          });
          break;
        }
        for (const row of data ?? []) {
          map[row.alias_normalized as string] = row.canonical_brand as string;
        }
        if ((data?.length ?? 0) < 1000) break;
      }
      return map;
    });
    const resolveCanonical = (s: string): string | null => {
      const k = brandNormalize(s);
      return k ? (aliasPairs[k] ?? null) : null;
    };

    const prepared = await step.run("upsert-reports", async () => {
      const sb = createServiceClient();
      if (!sb) return { prepared: 0, skipped_no_contact: 0, clones_attached: 0 };

      // Never clobber a report already sent for this period.
      const { data: sentRows } = await sb
        .from("brand_stewardship_reports")
        .select("brand_key")
        .eq("period_month", periodMonth)
        .eq("status", "sent");
      const alreadySent = new Set(
        (sentRows ?? []).map((r) => r.brand_key as string),
      );

      // Clone-side contact lookup keyed by brand_domain (inferred_target_domain
      // == known_brands.brand_domain). Email-contact gated like the onward side.
      const contactByDomain = new Map<string, KnownBrandContact>();
      for (const c of contacts) {
        if (c.brand_domain && c.security_contact_email) {
          contactByDomain.set(c.brand_domain.trim().toLowerCase(), c);
        }
      }

      // Merge both signals into one report per brand_key (the report set is the
      // UNION of "had onward reports" and "had clones detected").
      type Merged = {
        contact: KnownBrandContact;
        onward?: BrandMetrics;
        clones?: CloneBrandMetrics;
      };
      const byKey = new Map<string, Merged>();
      let skippedNoContact = 0;

      for (const [brand, m] of aggregated) {
        const contact = matchKnownBrand(brand, contacts, resolveCanonical);
        if (!contact || !contact.security_contact_email) {
          skippedNoContact += 1;
          continue;
        }
        const key = (contact.brand_key || deriveBrandKey(brand)).toLowerCase();
        const e = byKey.get(key) ?? { contact };
        e.onward = m;
        byKey.set(key, e);
      }

      for (const [brandDomain, cm] of cloneAgg) {
        const contact = contactByDomain.get(brandDomain);
        if (!contact) continue; // brand has no email contact — skip clone-only
        const key = (
          contact.brand_key || deriveBrandKey(contact.brand_name)
        ).toLowerCase();
        const e = byKey.get(key) ?? { contact };
        e.clones = cm;
        byKey.set(key, e);
      }

      let preparedCount = 0;
      let clonesAttached = 0;
      const nowIso = new Date().toISOString();

      for (const [key, e] of byKey) {
        if (alreadySent.has(key)) continue;

        const metrics: Record<string, unknown> = {
          detected: e.onward?.detected ?? 0,
          reported_by_destination: e.onward?.reportedByDestination ?? {},
          reports_sent: e.onward?.reportsSent ?? 0,
        };
        if (e.clones) {
          metrics.clones = {
            detected: e.clones.detected,
            by_classification: e.clones.byClassification,
            by_country: e.clones.byCountry,
            by_registrar: e.clones.byRegistrar,
            by_asn: e.clones.byAsn,
            domains: e.clones.domains,
            alert_ids: e.clones.alertIds,
          };
          clonesAttached += 1;
        }

        const { error } = await sb.from("brand_stewardship_reports").upsert(
          {
            brand_key: key,
            brand_name: e.contact.brand_name,
            period_month: periodMonth,
            metrics,
            evidence_scam_report_ids: e.onward?.scamReportIds ?? [],
            recipient_email: e.contact.security_contact_email,
            status: "prepared",
            prepared_at: nowIso,
          },
          { onConflict: "brand_key,period_month" },
        );
        if (error) {
          logger.error("brand-stewardship: upsert failed", {
            brandKey: key,
            period: periodMonth,
            error: error.message,
          });
          continue;
        }
        preparedCount += 1;
      }
      return {
        prepared: preparedCount,
        skipped_no_contact: skippedNoContact,
        clones_attached: clonesAttached,
      };
    });

    await step.run("telegram-digest", async () => {
      await sendAdminTelegramMessage(
        [
          `<b>Brand Stewardship — ${periodMonth} prepared</b>`,
          `Onward-active brands: <b>${aggregated.size}</b> · clone-active brands: <b>${cloneAgg.size}</b>`,
          `Reports prepared (have contact): <b>${prepared.prepared}</b>`,
          `…of which carry clone detections: <b>${prepared.clones_attached}</b>`,
          `Skipped (no known_brands contact): ${prepared.skipped_no_contact}`,
          `Review + send at askarthur.au/admin/brand-stewardship`,
        ].join("\n"),
      );
    });

    logger.info("brand-stewardship: complete", {
      period: periodMonth,
      onwardBrands: aggregated.size,
      cloneBrands: cloneAgg.size,
      ...prepared,
    });

    return {
      ok: true,
      period: periodMonth,
      onward_brands: aggregated.size,
      clone_brands: cloneAgg.size,
      ...prepared,
    };
  }),
);
