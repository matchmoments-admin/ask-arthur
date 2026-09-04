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
import { fetchAllRows } from "@askarthur/supabase/paginate";
import { loadAliasRecord } from "@/lib/brand-aliases";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import {
  applyCohortRules,
  CLONE_COHORT_SELECT,
  CLONE_COHORT_SOURCE,
  type CloneAlertRow,
} from "@/lib/clone-watch/clone-cohort";
import { computeWeaponisationRisk } from "@/lib/clone-watch/weaponisation-risk";
import {
  aggregateClonesByDomain,
  topRiskUnactioned,
  type CloneBrandMetrics,
  type CloneDetail,
} from "@/lib/clone-watch/clone-metrics";
import { priorMonthStart } from "@/lib/clone-watch/month-window";

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
/** Moved to lib/clone-watch/month-window.ts; re-exported for existing importers. */
export { priorMonthStart } from "@/lib/clone-watch/month-window";

// ── Clone-watch detections (the lookalike-domain + hosting/registrar source) ──

const CLONE_FETCH_LIMIT = 3000;

/**
 * Re-exported from its real home. The type lived here — inside an Inngest
 * function — while four `lib/` Modules imported it, pointing the dependency
 * from library to background job. That inversion is also why the two cohort
 * SELECT lists could drift apart and lose `clone_tactic`: the row shape had two
 * owners and no home. See lib/clone-watch/clone-cohort.ts.
 */
export type { CloneAlertRow } from "@/lib/clone-watch/clone-cohort";

/** Minimal HTML escape for the Telegram (HTML parse-mode) digest. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The clone rollup moved to lib/clone-watch/clone-metrics.ts — it is the
 * domain's central fold and had no business living inside an email cron. See
 * that file's header for why the inversion mattered. Re-exported so existing
 * importers (and brandStewardship.test.ts) keep working.
 */
export {
  aggregateClonesByDomain,
  toCloneDetail,
  topRiskUnactioned,
  type CloneBrandMetrics,
  type CloneDetail,
} from "@/lib/clone-watch/clone-metrics";

export const reportBrandStewardship = inngest.createFunction(
  {
    id: "report-brand-stewardship",
    // Raised (#1069): step boundaries queue for the account's 5 Hobby-plan
    // concurrency slots; the old budget could cancel healthy runs. Floor
    // guarded by inngestFinishBudgets.test.ts.
    timeouts: { finish: "8m" },
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
  withAxiomLogging(
    { fnId: "report-brand-stewardship" },
    async ({ event, step }) => {
      if (!featureFlags.brandStewardshipReport) {
        return {
          skipped: true,
          reason: "FF_BRAND_STEWARDSHIP_REPORT disabled",
        };
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
        const { rows: data, error } = await fetchAllRows<OnwardLogRow>(
          (from, to) =>
            sb
              .from("onward_report_log")
              .select("scam_report_id, destination, status")
              .eq("status", "sent")
              .gte("sent_at", period.startIso)
              .lt("sent_at", period.endIso)
              .not("scam_report_id", "is", null)
              .order("id", { ascending: true })
              .range(from, to) as unknown as PromiseLike<{
              data: OnwardLogRow[] | null;
              error: { message: string } | null;
            }>,
          { maxRows: ONWARD_LOG_FETCH_LIMIT },
        );
        if (error) {
          logger.error("brand-stewardship: onward log fetch failed", {
            error: error.message,
          });
          return [] as OnwardLogRow[];
        }
        if (data.length >= ONWARD_LOG_FETCH_LIMIT) {
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
        const { rows: data, error } = await fetchAllRows<CloneAlertRow>(
          (from, to) =>
            sb
              .from("shopfront_clone_alerts")
              // The cohort's own SELECT (clone-cohort.ts), shared with the
              // report card. campaign_key + clone_tactic feed
              // targeting-intelligence.ts; omitting one does not error, the
              // distributions just come back 100% empty, which reads as thin
              // classifier coverage rather than as a missing column.
              .select(CLONE_COHORT_SELECT)
              .eq("source", CLONE_COHORT_SOURCE)
              .gte("first_seen_at", period.startIso)
              .lt("first_seen_at", period.endIso)
              .not("inferred_target_domain", "is", null)
              // Exclude confirmed false positives, but KEEP untriaged rows (null) —
              // most detections are untriaged and the digest is meant to show them.
              .or("triage_status.is.null,triage_status.neq.fp")
              .order("id", { ascending: true })
              .range(from, to) as unknown as PromiseLike<{
              data: CloneAlertRow[] | null;
              error: { message: string } | null;
            }>,
          { maxRows: CLONE_FETCH_LIMIT },
        );
        if (error) {
          logger.error("brand-stewardship: clone fetch failed", {
            error: error.message,
          });
          return [] as CloneAlertRow[];
        }
        if (data.length >= CLONE_FETCH_LIMIT) {
          logger.warn("brand-stewardship: clone fetch hit LIMIT", {
            limit: CLONE_FETCH_LIMIT,
            period: periodMonth,
          });
        }
        // Drop generic-dictionary FP brands (domain.com.au / lendi.com.au / …)
        // so they never surface in the digest or the LinkedIn worklist, even if
        // a stale detection wasn't triaged 'fp'. Mirrors the Netcraft denylist.
        return applyCohortRules((data ?? []) as unknown as CloneAlertRow[]);
      });
      // F3: per-row weaponisation risk (the ONE formula — weaponisation-risk.ts)
      // via a lightweight brand-category map (~300 rows). Inside step.run so the
      // clock read is replay-stable.
      const riskByAlertId = await step.run("compute-risk-scores", async () => {
        const sb = createServiceClient();
        const categories = new Map<string, string>();
        if (sb) {
          const { data } = await sb
            .from("known_brands")
            .select("brand_domain, brand_category")
            .not("brand_domain", "is", null);
          for (const r of (data ?? []) as Array<{
            brand_domain: string | null;
            brand_category: string | null;
          }>) {
            if (
              r.brand_domain &&
              r.brand_category &&
              !categories.has(r.brand_domain)
            ) {
              categories.set(r.brand_domain, r.brand_category);
            }
          }
        }
        const nowMs = Date.now();
        const out: Record<number, number> = {};
        for (const row of cloneRows) {
          out[row.id] = computeWeaponisationRisk({
            urlscanClassification: row.urlscan_classification,
            signals: row.signals ?? null,
            isClone: row.clone_watch_classifications?.is_clone ?? null,
            confidence: row.clone_watch_classifications?.confidence ?? null,
            attackIntent:
              row.clone_watch_classifications?.attack_intent ?? null,
            brandCategory: row.inferred_target_domain
              ? (categories.get(row.inferred_target_domain) ?? null)
              : null,
            whoisCreatedDate: row.attribution?.whois?.createdDate ?? null,
            ipAbuseConfidenceScore:
              row.attribution?.ip_rep?.abuseConfidenceScore ?? null,
            auAbnStatus: row.attribution?.au_registrant?.abnStatus ?? null,
            auNameMatches:
              row.attribution?.au_registrant?.nameMatchesAbn ?? null,
            nowMs,
          }).score;
        }
        return out;
      });
      const cloneAgg = aggregateClonesByDomain(cloneRows, riskByAlertId);

      // Reddit community-report mentions for the period (data-prep only — the
      // brand-facing send stays gated on #371). Bounded window read; no paid API.
      const redditRows = await step.run("fetch-reddit-mentions", async () => {
        const sb = createServiceClient();
        if (!sb) return [] as RedditPostIntelRow[];
        const { rows: data, error } = await fetchAllRows<RedditPostIntelRow>(
          (from, to) =>
            sb
              .from("reddit_post_intel")
              .select("brands_impersonated, narrative_summary")
              .gte("processed_at", period.startIso)
              .lt("processed_at", period.endIso)
              .order("id", { ascending: true })
              .range(from, to) as unknown as PromiseLike<{
              data: RedditPostIntelRow[] | null;
              error: { message: string } | null;
            }>,
          { maxRows: REDDIT_FETCH_LIMIT },
        );
        if (error) {
          logger.error("brand-stewardship: reddit mention fetch failed", {
            error: error.message,
          });
          return [] as RedditPostIntelRow[];
        }
        return (data ?? []) as RedditPostIntelRow[];
      });
      const redditAgg = aggregateRedditByBrand(redditRows);

      if (
        aggregated.size === 0 &&
        cloneAgg.size === 0 &&
        redditAgg.size === 0
      ) {
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
          const key = (
            contact.brand_key || deriveBrandKey(brand)
          ).toLowerCase();
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
          const contact = matchKnownBrand(
            rm.rawBrand,
            contacts,
            resolveCanonical,
          );
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
              weaponised_after_decline: e.clones.weaponisedAfterDecline,
              re_taken_down: e.clones.reTakenDown,
              top_risk: topRiskUnactioned(e.clones.domains),
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
                  weaponised_after_decline: cm.weaponisedAfterDecline,
                  re_taken_down: cm.reTakenDown,
                  top_risk: topRiskUnactioned(cm.domains),
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
              (b) =>
                `· ${escapeHtml(b.domain)} — ${b.count} clone${b.count === 1 ? "" : "s"}`,
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
    },
  ),
);
