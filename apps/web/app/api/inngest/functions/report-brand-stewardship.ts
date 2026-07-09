import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import {
  brandNormalize,
  buildBrandResolver,
  type BrandAliasRecord,
} from "@askarthur/shopfront-glue";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { loadAliasRecord } from "@/lib/brand-aliases";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import { isFpBrand } from "@/lib/clone-watch/fp-brand-denylist";

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

// ── Reddit community-report mentions ──────────────────────────────────────
// reddit_post_intel.brands_impersonated is a per-post list of brands named in
// community scam reports. We aggregate it into "your brand was named in N
// community reports this month" — a brand-facing signal that exists even when
// there were zero clones. Caveat (carried from the plan): the scrape is global
// r/Scams, so overlap skews US/global brands; AU banks rarely appear.

const REDDIT_FETCH_LIMIT = 5000;
const REDDIT_SAMPLE_NARRATIVES = 3;

export interface RedditPostIntelRow {
  brands_impersonated: string[] | null;
  narrative_summary: string | null;
}

export interface RedditBrandMetrics {
  /** Representative raw brand string (for known_brands matching). */
  rawBrand: string;
  /** Distinct Reddit posts in the period that named this brand. */
  mentions: number;
  /** Up to N PII-scrubbed one-sentence narratives as evidence. */
  sampleNarratives: string[];
}

/**
 * Aggregate reddit_post_intel.brands_impersonated by normalized brand for the
 * period — one mention per distinct normalized brand per POST (a post listing
 * the same brand twice counts once). Carries a representative raw string for
 * known_brands matching + up to N scrubbed narrative snippets. Pure + tested.
 */
export function aggregateRedditByBrand(
  rows: RedditPostIntelRow[],
): Map<string, RedditBrandMetrics> {
  const out = new Map<string, RedditBrandMetrics>();
  for (const row of rows) {
    const seen = new Set<string>();
    for (const raw of row.brands_impersonated ?? []) {
      const norm = brandNormalize(raw);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      let m = out.get(norm);
      if (!m) {
        m = { rawBrand: raw.trim(), mentions: 0, sampleNarratives: [] };
        out.set(norm, m);
      }
      m.mentions += 1;
      const narrative = row.narrative_summary?.trim();
      if (
        narrative &&
        m.sampleNarratives.length < REDDIT_SAMPLE_NARRATIVES &&
        !m.sampleNarratives.includes(narrative)
      ) {
        m.sampleNarratives.push(narrative);
      }
    }
  }
  return out;
}

/** First day of the prior calendar month (UTC) given a reference date. */
export function priorMonthStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0),
  );
}

// ── Clone-watch detections (the lookalike-domain + hosting/registrar source) ──

const CLONE_FETCH_LIMIT = 3000;
// Per-brand detail rows stored in metrics.clones.domains. Sized so the public
// share page (/clone-report/[token]) is effectively the FULL list for all
// real-world volumes (observed max ~30/brand); the email renders a much smaller
// slice (EMAIL_CLONE_DISPLAY_CAP in BrandStewardshipReport) and links here for
// the rest. by_country/registrar/asn + `detected` always reflect the true total.
const CLONE_DETAIL_CAP = 100;

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
  submitted_to: Record<string, unknown> | null;
  lifecycle_state: string | null;
  netcraft_declined_at: string | null;
  weaponised_at: string | null;
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
  /** Distinct clone domains we submitted to Netcraft (browser/blocklist). */
  netcraftReported: number;
  /** Netcraft actioned it (lifecycle taken_down). */
  takenDown: number;
  /** Netcraft graded it non-malicious (lifecycle declined) — still live/parked. */
  declined: number;
  /** We filed a report_issue to force a re-review (netcraft_issue.issue_reported_at). */
  escalated: number;
  /** Flipped to active phishing (lifecycle weaponised) — "declined ≠ safe". */
  weaponised: number;
  /** Escalated AND now taken_down — the "we forced it through" win. */
  reTakenDown: number;
  byClassification: Record<string, number>;
  /** Consumable analytics — counts across ALL deduped clones (not just the
   *  capped detail list), so the email's breakdown bars reflect the full set. */
  byCountry: Record<string, number>;
  byRegistrar: Record<string, number>;
  byAsn: Record<string, number>;
  domains: CloneDetail[];
  alertIds: number[];
}

/**
 * Bucket a nullable dimension value, folding empties into "Unknown".
 * Coerces with String() because the values come from the clone attribution
 * JSONB (asn / country / registrar), where a value can be a NUMBER at runtime
 * (e.g. an ASN stored as an integer) despite the typed shape — calling .trim()
 * on a number threw `TypeError: t.trim is not a function` and aborted the whole
 * monthly prepare run (2026-06-15).
 */
function bump(map: Record<string, number>, value: unknown): void {
  const s = value == null ? "" : String(value).trim();
  const key = s || "Unknown";
  map[key] = (map[key] ?? 0) + 1;
}

/** Minimal HTML escape for the Telegram (HTML parse-mode) digest. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
        netcraftReported: 0,
        takenDown: 0,
        declined: 0,
        escalated: 0,
        weaponised: 0,
        reTakenDown: 0,
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
    if (row.submitted_to && "netcraft" in row.submitted_to) {
      m.netcraftReported += 1;
    }
    // Lifecycle-transition counts (PR3.2) — the story the reconciler (PR3.1) now
    // populates: taken_down / declined / escalated / weaponised / re-taken-down.
    const escalated = Boolean(
      (
        row.submitted_to?.["netcraft_issue"] as
          | { issue_reported_at?: unknown }
          | undefined
      )?.issue_reported_at,
    );
    if (escalated) m.escalated += 1;
    if (row.lifecycle_state === "taken_down") {
      m.takenDown += 1;
      if (escalated) m.reTakenDown += 1;
    } else if (row.lifecycle_state === "declined") {
      m.declined += 1;
    } else if (row.lifecycle_state === "weaponised") {
      m.weaponised += 1;
    }
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
          "id, candidate_domain, inferred_target_domain, urlscan_classification, urlscan_evidence, attribution, submitted_to, lifecycle_state, netcraft_declined_at, weaponised_at",
        )
        .eq("source", "nrd")
        .gte("first_seen_at", period.startIso)
        .lt("first_seen_at", period.endIso)
        .not("inferred_target_domain", "is", null)
        // Exclude confirmed false positives, but KEEP untriaged rows (null) —
        // most detections are untriaged and the digest is meant to show them.
        .or("triage_status.is.null,triage_status.neq.fp")
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
      // Drop generic-dictionary FP brands (domain.com.au / lendi.com.au / …)
      // so they never surface in the digest or the LinkedIn worklist, even if
      // a stale detection wasn't triaged 'fp'. Mirrors the Netcraft denylist.
      return ((data ?? []) as unknown as CloneAlertRow[]).filter(
        (r) => !isFpBrand(r.inferred_target_domain),
      );
    });
    const cloneAgg = aggregateClonesByDomain(cloneRows);

    // Reddit community-report mentions for the period (data-prep only — the
    // brand-facing send stays gated on #371). Bounded window read; no paid API.
    const redditRows = await step.run("fetch-reddit-mentions", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as RedditPostIntelRow[];
      const { data, error } = await sb
        .from("reddit_post_intel")
        .select("brands_impersonated, narrative_summary")
        .gte("processed_at", period.startIso)
        .lt("processed_at", period.endIso)
        .limit(REDDIT_FETCH_LIMIT);
      if (error) {
        logger.error("brand-stewardship: reddit mention fetch failed", {
          error: error.message,
        });
        return [] as RedditPostIntelRow[];
      }
      return (data ?? []) as RedditPostIntelRow[];
    });
    const redditAgg = aggregateRedditByBrand(redditRows);

    if (aggregated.size === 0 && cloneAgg.size === 0 && redditAgg.size === 0) {
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
      if (!sb) return {} as BrandAliasRecord;
      return loadAliasRecord(sb, "brand-stewardship");
    });
    const resolveCanonical = buildBrandResolver(aliasPairs);

    const prepared = await step.run("upsert-reports", async () => {
      const sb = createServiceClient();
      if (!sb)
        return {
          prepared: 0,
          skipped_no_contact: 0,
          clones_attached: 0,
          reddit_attached: 0,
          reddit_skipped_no_contact: 0,
          no_contact_clone_brands: 0,
          no_contact_top: [] as Array<{ domain: string; count: number }>,
        };

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
        reddit?: RedditBrandMetrics;
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

      // Clones for brands with NO known security contact. We can't email them,
      // but we DON'T drop them silently — they become 'no_contact' rows so the
      // admin can do manual outreach (find a security.txt, or LinkedIn the
      // brand's security lead). Surfaced in the dashboard + the Telegram digest.
      const noContact = new Map<string, CloneBrandMetrics>();

      for (const [brandDomain, cm] of cloneAgg) {
        const contact = contactByDomain.get(brandDomain);
        if (!contact) {
          noContact.set(brandDomain, cm);
          continue;
        }
        const key = (
          contact.brand_key || deriveBrandKey(contact.brand_name)
        ).toLowerCase();
        const e = byKey.get(key) ?? { contact };
        e.clones = cm;
        byKey.set(key, e);
      }

      // Reddit mentions → attach to contacted brands only (gated to a known
      // contact, same as onward). Reddit-only contacted brands create a report
      // even with zero clones/onward. No-contact reddit brands are dropped
      // (name-based, no domain worklist to join) — counted in the tally.
      let redditSkippedNoContact = 0;
      for (const [, rm] of redditAgg) {
        const contact = matchKnownBrand(rm.rawBrand, contacts, resolveCanonical);
        if (!contact || !contact.security_contact_email) {
          redditSkippedNoContact += 1;
          continue;
        }
        const key = (
          contact.brand_key || deriveBrandKey(contact.brand_name)
        ).toLowerCase();
        const e = byKey.get(key) ?? { contact };
        e.reddit = rm;
        byKey.set(key, e);
      }

      let preparedCount = 0;
      let clonesAttached = 0;
      let redditAttached = 0;
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
            netcraft_reported: e.clones.netcraftReported,
            taken_down: e.clones.takenDown,
            declined: e.clones.declined,
            escalated: e.clones.escalated,
            weaponised: e.clones.weaponised,
            re_taken_down: e.clones.reTakenDown,
            by_classification: e.clones.byClassification,
            by_country: e.clones.byCountry,
            by_registrar: e.clones.byRegistrar,
            by_asn: e.clones.byAsn,
            domains: e.clones.domains,
            alert_ids: e.clones.alertIds,
          };
          clonesAttached += 1;
        }
        if (e.reddit) {
          metrics.reddit = {
            mentions: e.reddit.mentions,
            sample_narratives: e.reddit.sampleNarratives,
          };
          redditAttached += 1;
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

      // No-contact clone brands → 'skipped'/'no_contact' rows (recipient null),
      // carrying the clone metrics so the dashboard shows the volume + a Preview.
      // brand_key is namespaced so it never collides with a real (contacted)
      // row for the same brand in a later month.
      let noContactCount = 0;
      const noContactBrands: Array<{ domain: string; count: number }> = [];
      for (const [brandDomain, cm] of noContact) {
        const key = `nocontact_${deriveBrandKey(brandDomain)}`;
        if (alreadySent.has(key)) continue;
        const { error } = await sb.from("brand_stewardship_reports").upsert(
          {
            brand_key: key,
            brand_name: brandDomain,
            period_month: periodMonth,
            metrics: {
              detected: 0,
              reported_by_destination: {},
              reports_sent: 0,
              clones: {
                detected: cm.detected,
                netcraft_reported: cm.netcraftReported,
                taken_down: cm.takenDown,
                declined: cm.declined,
                escalated: cm.escalated,
                weaponised: cm.weaponised,
                re_taken_down: cm.reTakenDown,
                by_classification: cm.byClassification,
                by_country: cm.byCountry,
                by_registrar: cm.byRegistrar,
                by_asn: cm.byAsn,
                domains: cm.domains,
                alert_ids: cm.alertIds,
              },
            },
            evidence_scam_report_ids: [],
            recipient_email: null,
            status: "skipped",
            status_reason: "no_contact",
            prepared_at: nowIso,
          },
          { onConflict: "brand_key,period_month" },
        );
        if (error) {
          logger.error("brand-stewardship: no-contact upsert failed", {
            brandDomain,
            period: periodMonth,
            error: error.message,
          });
          continue;
        }
        noContactCount += 1;
        noContactBrands.push({ domain: brandDomain, count: cm.detected });
      }
      noContactBrands.sort((a, b) => b.count - a.count);

      return {
        prepared: preparedCount,
        skipped_no_contact: skippedNoContact,
        clones_attached: clonesAttached,
        reddit_attached: redditAttached,
        reddit_skipped_no_contact: redditSkippedNoContact,
        no_contact_clone_brands: noContactCount,
        no_contact_top: noContactBrands.slice(0, 15),
      };
    });

    await step.run("telegram-digest", async () => {
      const lines = [
        `<b>Brand Stewardship — ${periodMonth} prepared</b>`,
        `Onward-active brands: <b>${aggregated.size}</b> · clone-active brands: <b>${cloneAgg.size}</b>`,
        `Reports prepared (have contact): <b>${prepared.prepared}</b>`,
        `…of which carry clone detections: <b>${prepared.clones_attached}</b>`,
        `…of which carry Reddit mentions: <b>${prepared.reddit_attached}</b> (reddit-active brands: ${redditAgg.size})`,
        `Skipped (no known_brands contact): ${prepared.skipped_no_contact}`,
      ];
      // Manual-outreach nudge: clone-targeted brands we can't email (no contact).
      if (prepared.no_contact_clone_brands > 0) {
        lines.push(
          ``,
          `⚠️ <b>${prepared.no_contact_clone_brands} clone-targeted brand(s) have NO security contact</b> — manual outreach (security.txt / LinkedIn):`,
          ...prepared.no_contact_top.map(
            (b) => `· ${escapeHtml(b.domain)} — ${b.count} clone${b.count === 1 ? "" : "s"}`,
          ),
        );
      }
      lines.push(``, `Review + send at askarthur.au/admin/brand-stewardship`);
      await sendAdminTelegramMessage(lines.join("\n"));
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
