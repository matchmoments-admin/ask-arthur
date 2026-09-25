import { inngest } from "@askarthur/scam-engine/inngest/client";
import { attributionRiskInputs } from "@/lib/clone-watch/attribution";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import {
  brandNormalize,
  buildBrandResolver,
  type BrandAliasRecord,
} from "@askarthur/shopfront-glue";
import { html, joinHtml, type SafeHtml } from "@askarthur/utils/html";
import { logger } from "@askarthur/utils/logger";
import { fetchAllRows } from "@askarthur/supabase/paginate";
import { loadAliasRecord } from "@/lib/brand-aliases";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import {
  applyCohortRules,
  CLONE_COHORT_SELECT,
  type CloneAlertRow,
} from "@/lib/clone-watch/clone-cohort";
import { computeWeaponisationRisk } from "@/lib/clone-watch/weaponisation-risk";
import { aggregateClonesByDomain } from "@/lib/clone-watch/clone-metrics";
import { monthWindow, priorMonthStart } from "@/lib/clone-watch/month-window";
import {
  ledgerCloneMetrics,
  MONTHLY_STORE_WRITTEN_EVENT,
  readMonthlyBrandStore,
  type LedgerStoreRow,
} from "@/lib/clone-watch/monthly-brand-store";
import { recordLaneOutcome } from "@askarthur/scam-engine/lane-outcome";

/**
 * Monthly Brand Stewardship Report — aggregation + ledger (WS2-cap).
 *
 * Runs once per published month (after clone-watch-report-summary — see the
 * trigger note below), aggregates that calendar month's
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
 * Gated by FF_BRAND_STEWARDSHIP_REPORT (default OFF). When OFF the run
 * no-ops, so no rows are prepared and (downstream) no emails are sent.
 *
 * Honesty: we only count onward reports we actually SENT (status='sent') and
 * never claim takedowns — these destinations (OpenPhish/APWG/ACMA) are
 * fire-and-forget email intakes with no takedown callback.
 *
 * CLONE METRICS COME FROM THE MONTHLY BRAND STORE (v319), not a refold.
 * This function used to run on its own cron (0 9 1 * *) — two hours BEFORE
 * clone-watch-report-summary — and re-fetch + refold the month's alerts, so the
 * brand-facing email and the published report counted the same month twice, on
 * two clocks. It is now triggered by that function's completion event
 * (`clone-watch/monthly-store.written.v1`) and reads the store it wrote:
 * counts from the frozen month, the per-lookalike watch-list from the store's
 * member alert ids (their CURRENT state — see ledgerCloneMetrics).
 *
 * Why August 2026 has no batch: the 1 Sep 09:00 run was CANCELLED at its 4m
 * finish timeout (Inngest function.cancelled 09:05:44, the Aug 27–Sep 2 5-slot
 * starvation; ADR-0019 amendment). A cancelled run gets no retry and no error,
 * and nothing re-fired it. #1072 raised the budget to 8m the next day; this
 * rewrite also removes the alert refold step. Re-fire August by hand:
 * `report/brand-stewardship.manual-trigger.v1` { periodMonth: "2026-08" } (or "2026-08-01").
 */

const ONWARD_LOG_FETCH_LIMIT = 5000;

/** One onward_report_log row. Since v318 a row reports EITHER a scam report or
 *  a clone-watch lookalike (source='clone_alert'); both count as "reported". */
interface OnwardLogRow {
  scam_report_id: number | null;
  clone_alert_id?: number | null;
  destination: string;
  status: string;
}

export interface BrandMetrics {
  /** Distinct subjects reported — scam reports + clone alerts. */
  detected: number;
  reportedByDestination: Record<string, number>;
  reportsSent: number;
  scamReportIds: number[];
  /** Clone alerts reported through the onward ledger (v318). */
  cloneAlertIds: number[];
}

/**
 * The brand string a clone-sourced onward row aggregates under. The known_brands
 * name for the alert's inferred target domain when there is one — then
 * matchKnownBrand's direct pass matches it exactly — else the alert's
 * normalised brand (matched via the alias layer, like a scam report's
 * free-text impersonated_brand).
 */
export function cloneBrandLabel(
  alert: {
    inferred_target_domain: string | null;
    target_brand_normalized: string | null;
  },
  brandNameByDomain: Map<string, string>,
): string | null {
  const domain = alert.inferred_target_domain?.trim().toLowerCase();
  const named = domain ? brandNameByDomain.get(domain) : undefined;
  return named ?? alert.target_brand_normalized?.trim() ?? null;
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
 * Both ledger subjects count (v318): a scam report resolves its brand through
 * `brandByReportId`, a clone alert through `brandByCloneAlertId`. A row whose
 * subject has no resolved brand (including a clone row whose alert the FP purge
 * removed) is not attributed to any brand.
 */
export function aggregateOnwardByBrand(
  rows: OnwardLogRow[],
  brandByReportId: Map<number, string>,
  brandByCloneAlertId: Map<number, string> = new Map(),
): Map<string, BrandMetrics> {
  const out = new Map<string, BrandMetrics>();
  // Track distinct subjects per brand so `detected` isn't inflated by multiple
  // destinations reporting the same scam / lookalike.
  const seenIds = new Map<string, Set<string>>();

  for (const row of rows) {
    if (row.status !== "sent") continue;
    const cloneId = row.clone_alert_id ?? null;
    const reportId = row.scam_report_id;
    const brand =
      cloneId != null
        ? brandByCloneAlertId.get(cloneId)
        : reportId != null
          ? brandByReportId.get(reportId)
          : undefined;
    if (!brand) continue;

    let m = out.get(brand);
    if (!m) {
      m = {
        detected: 0,
        reportedByDestination: {},
        reportsSent: 0,
        scamReportIds: [],
        cloneAlertIds: [],
      };
      out.set(brand, m);
      seenIds.set(brand, new Set());
    }
    m.reportsSent += 1;
    m.reportedByDestination[row.destination] =
      (m.reportedByDestination[row.destination] ?? 0) + 1;

    const ids = seenIds.get(brand)!;
    const subjectKey = cloneId != null ? `clone:${cloneId}` : `report:${reportId}`;
    if (!ids.has(subjectKey)) {
      ids.add(subjectKey);
      if (cloneId != null) m.cloneAlertIds.push(cloneId);
      else m.scamReportIds.push(reportId as number);
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

/**
 * The reporting window. A manual `periodMonth` accepts BOTH `YYYY-MM` (what
 * clone-watch/report-summary.manual-trigger.v1 takes) and `YYYY-MM-01` (what
 * the store-written event carries) — `monthWindow` normalises either, and
 * throws on anything else rather than computing an Invalid Date. Defaults to
 * the prior calendar month. Pure; exported for tests.
 */
export function stewardshipWindow(
  periodMonth?: string,
  now: Date = new Date(),
): { startIso: string; endIso: string } {
  const w = monthWindow(periodMonth ?? priorMonthStart(now).toISOString().slice(0, 7));
  return { startIso: w.startIso, endIso: w.endIso };
}

// ── Clone-watch detections (the lookalike-domain + hosting/registrar source) ──

/** `.in("id", …)` chunk for the member-alert read. */
const MEMBER_ID_CHUNK = 500;

/**
 * Re-exported from its real home. The type lived here — inside an Inngest
 * function — while four `lib/` Modules imported it, pointing the dependency
 * from library to background job. That inversion is also why the two cohort
 * SELECT lists could drift apart and lose `clone_tactic`: the row shape had two
 * owners and no home. See lib/clone-watch/clone-cohort.ts.
 */
export type { CloneAlertRow } from "@/lib/clone-watch/clone-cohort";


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
import { laneGate } from "@/lib/laneHealth";

/**
 * The trigger set, exported so a test can pin the ordering contract: the
 * store's completion event, never a free-running cron that could fire before
 * the store is written (the pre-v319 cron ran two hours early).
 */
export const STEWARDSHIP_TRIGGERS = [
  { event: MONTHLY_STORE_WRITTEN_EVENT }, // { periodMonth: "YYYY-MM-01", … }
  // Manual re-run (ops / pre-launch shadow review). Optional event.data.
  // periodMonth ("YYYY-MM" or "YYYY-MM-01") overrides the window. The month's store must
  // already be written (clone-watch/report-summary.manual-trigger.v1) or the
  // clone section is empty — the Telegram digest says so.
  { event: "report/brand-stewardship.manual-trigger.v1" },
] as const;

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
  [...STEWARDSHIP_TRIGGERS],
  withAxiomLogging(
    { fnId: "report-brand-stewardship" },
    async ({ event, step }) => {
      // Flag gate declared once, in LANE_SHAPES (the digest reads the same list).
      const gate = laneGate("report-brand-stewardship");
      if (!gate.ok) return { skipped: true, reason: gate.reason };

      const periodOverride = (
        event?.data as { periodMonth?: string } | undefined
      )?.periodMonth;

      // Compute the reporting window inside a step so it's memoised across
      // Inngest replays (deterministic). Defaults to the prior calendar month;
      // a manual periodMonth override targets a specific month.
      const period = await step.run("compute-period", async () =>
        stewardshipWindow(periodOverride),
      );
      const periodMonth = period.startIso.slice(0, 10); // YYYY-MM-01

      const logRows = await step.run("fetch-onward-log", async () => {
        const sb = createServiceClient();
        if (!sb) throw new Error("brand-stewardship: onward data unavailable");
        const { rows: data, error, truncated } = await fetchAllRows<OnwardLogRow>(
          (from, to) =>
            sb
              .from("onward_report_log")
              // Both ledger subjects (v318): scam-report rows AND clone-watch
              // enforcement rows. A clone row whose alert was purged has
              // neither id and is excluded — there is no brand to credit.
              .select("scam_report_id, clone_alert_id, destination, status")
              .eq("status", "sent")
              .gte("sent_at", period.startIso)
              .lt("sent_at", period.endIso)
              .or("scam_report_id.not.is.null,clone_alert_id.not.is.null")
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
          throw new Error("brand-stewardship: onward data unavailable");
        }
        if (truncated) {
          throw new Error("brand-stewardship: onward data truncated");
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
        const ids = [
          ...new Set(
            logRows
              .map((r) => r.scam_report_id)
              .filter((id): id is number => id != null),
          ),
        ];
        const map: Record<string, string> = {};
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          const { data, error } = await sb
            .from("scam_reports")
            .select("id, impersonated_brand")
            .in("id", chunk);
          if (error) throw new Error(`brand resolution failed: ${error.message}`);
          for (const row of data ?? []) {
            const brand = (row.impersonated_brand as string | null)?.trim();
            if (brand) map[String(row.id)] = brand;
          }
        }
        return map;
      });

      // Clone-sourced onward rows (v318) resolve to a brand via the alert's
      // inferred target domain → known_brands.brand_name (cloneBrandLabel).
      const brandByCloneId = await step.run("resolve-clone-brands", async () => {
        const ids = [
          ...new Set(
            logRows
              .map((r) => r.clone_alert_id)
              .filter((id): id is number => id != null),
          ),
        ];
        const map: Record<string, string> = {};
        if (ids.length === 0) return map;
        const sb = createServiceClient();
        if (!sb) throw new Error("brand-stewardship: clone brand data unavailable");
        const alerts: Array<{
          id: number;
          inferred_target_domain: string | null;
          target_brand_normalized: string | null;
        }> = [];
        for (let i = 0; i < ids.length; i += 500) {
          const { data, error } = await sb
            .from("shopfront_clone_alerts")
            .select("id, inferred_target_domain, target_brand_normalized")
            .in("id", ids.slice(i, i + 500));
          if (error) throw new Error(`clone brand resolution failed: ${error.message}`);
          alerts.push(...((data ?? []) as typeof alerts));
        }
        const domains = [
          ...new Set(
            alerts
              .map((a) => a.inferred_target_domain?.trim().toLowerCase())
              .filter((d): d is string => !!d),
          ),
        ];
        const nameByDomain = new Map<string, string>();
        if (domains.length > 0) {
          const { data, error } = await sb
            .from("known_brands")
            .select("brand_domain, brand_name")
            .in("brand_domain", domains);
          if (error) throw new Error(`clone brand names failed: ${error.message}`);
          for (const b of (data ?? []) as Array<{ brand_domain: string; brand_name: string }>) {
            const d = b.brand_domain.trim().toLowerCase();
            if (!nameByDomain.has(d)) nameByDomain.set(d, b.brand_name);
          }
        }
        for (const a of alerts) {
          const label = cloneBrandLabel(a, nameByDomain);
          if (label) map[String(a.id)] = label;
        }
        return map;
      });

      const toIdMap = (rec: Record<string, string>) =>
        new Map<number, string>(Object.entries(rec).map(([k, v]) => [Number(k), v]));
      const aggregated = aggregateOnwardByBrand(
        logRows,
        toIdMap(brandByReportId),
        toIdMap(brandByCloneId),
      );

      // Clone-watch lookalike detections for the period — READ from the
      // monthly brand store (v319), which clone-watch-report-summary wrote and
      // froze just before emitting the event that triggered this run.
      //
      // Membership is the store's (alert_ids), so this step never re-derives
      // "who counts for brand X in month M" — the window filter, the source and
      // the cohort rules used to be restated here and could disagree with the
      // published report. The member alerts are fetched only for the
      // per-lookalike watch-list, which is about their state NOW.
      const clonesFromStore = await step.run("read-clone-store", async () => {
        const sb = createServiceClient();
        if (!sb) throw new Error("brand-stewardship: clone data unavailable");
        const storeRows = await readMonthlyBrandStore(sb, periodMonth);

        const ids = [...new Set(storeRows.flatMap((r) => r.alert_ids ?? []))];
        const members: CloneAlertRow[] = [];
        for (let i = 0; i < ids.length; i += MEMBER_ID_CHUNK) {
          const chunk = ids.slice(i, i + MEMBER_ID_CHUNK);
          const { data, error } = await sb
            .from("shopfront_clone_alerts")
            .select(CLONE_COHORT_SELECT)
            .in("id", chunk);
          if (error) {
            logger.error("brand-stewardship: member alert fetch failed", {
              error: error.message,
            });
            throw new Error("brand-stewardship: clone data unavailable");
          }
          members.push(...((data ?? []) as unknown as CloneAlertRow[]));
        }
        members.sort((a, b) => a.id - b.id);
        // Counts are frozen in the store; this only keeps a lookalike triaged
        // `fp` SINCE publication off the brand-facing watch-list.
        const cloneRows = applyCohortRules(members);
        return {
          storeRows,
          cloneRows,
          frozenAt: storeRows[0]?.frozen_at ?? null,
          // Member ids that no longer resolve to a (non-fp) alert — counted in
          // the store, missing from the watch-list. Surfaced, not hidden.
          unreadMembers: ids.length - cloneRows.length,
        };
      });
      const cloneRows = clonesFromStore.cloneRows;
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
            ...attributionRiskInputs(row.attribution, {
              firstSeenAt: row.first_seen_at ?? null,
            }),
            nowMs,
          }).score;
        }
        return out;
      });
      // Detail (watch-list + breakdown bars) over exactly the member alerts;
      // the COUNTS come from the store row — see ledgerCloneMetrics.
      const cloneDetail = aggregateClonesByDomain(cloneRows, riskByAlertId);
      const cloneLedger = new Map<
        string,
        { store: LedgerStoreRow; metrics: Record<string, unknown> }
      >(
        clonesFromStore.storeRows.map((r) => [
          r.brand,
          { store: r, metrics: ledgerCloneMetrics(r, cloneDetail.get(r.brand)) },
        ]),
      );

      // Reddit community-report mentions for the period (data-prep only — the
      // brand-facing send stays gated on #371). Bounded window read; no paid API.
      const redditRows = await step.run("fetch-reddit-mentions", async () => {
        const sb = createServiceClient();
        if (!sb) throw new Error("brand-stewardship: reddit data unavailable");
        const { rows: data, error, truncated } = await fetchAllRows<RedditPostIntelRow>(
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
        if (truncated) throw new Error("brand-stewardship: reddit data truncated");
        if (error) {
          logger.error("brand-stewardship: reddit mention fetch failed", {
            error: error.message,
          });
          throw new Error("brand-stewardship: reddit data unavailable");
        }
        return (data ?? []) as RedditPostIntelRow[];
      });
      const redditAgg = aggregateRedditByBrand(redditRows);

      if (
        aggregated.size === 0 &&
        cloneLedger.size === 0 &&
        redditAgg.size === 0
      ) {
        await step.run("log-outcome-quiet", () =>
          recordLaneOutcome("report-brand-stewardship", 0, {
            reason: "no_activity",
            prepared: 0,
            failed: 0,
            clone_brands: 0,
          }),
        );
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
            failed: 0,
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
          clones?: Record<string, unknown>;
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
        const noContact = new Map<
          string,
          { store: LedgerStoreRow; metrics: Record<string, unknown> }
        >();

        for (const [brandDomain, ledger] of cloneLedger) {
          const contact = contactByDomain.get(brandDomain);
          if (!contact) {
            noContact.set(brandDomain, ledger);
            continue;
          }
          const key = (
            contact.brand_key || deriveBrandKey(contact.brand_name)
          ).toLowerCase();
          const e = byKey.get(key) ?? { contact };
          e.clones = ledger.metrics;
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
        // Upserts that did not land. Previously `logger.error; continue;` —
        // counted only by absence from `prepared`, which is indistinguishable
        // from a brand that was skipped on purpose.
        let failed = 0;
        const nowIso = new Date().toISOString();

        for (const [key, e] of byKey) {
          if (alreadySent.has(key)) continue;

          const metrics: Record<string, unknown> = {
            detected: e.onward?.detected ?? 0,
            reported_by_destination: e.onward?.reportedByDestination ?? {},
            reports_sent: e.onward?.reportsSent ?? 0,
            // Evidence for clone-sourced sends (v318); scam-report evidence
            // stays in evidence_scam_report_ids.
            reported_clone_alert_ids: e.onward?.cloneAlertIds ?? [],
          };
          if (e.clones) {
            metrics.clones = e.clones;
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
            failed += 1;
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
        for (const [brandDomain, { store, metrics: cloneMetrics }] of noContact) {
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
                clones: cloneMetrics,
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
            failed += 1;
            continue;
          }
          noContactCount += 1;
          noContactBrands.push({ domain: brandDomain, count: store.clones });
        }
        noContactBrands.sort((a, b) => b.count - a.count);

        return {
          prepared: preparedCount,
          failed,
          skipped_no_contact: skippedNoContact,
          clones_attached: clonesAttached,
          reddit_attached: redditAttached,
          reddit_skipped_no_contact: redditSkippedNoContact,
          no_contact_clone_brands: noContactCount,
          no_contact_top: noContactBrands.slice(0, 15),
        };
      });

      await step.run("telegram-digest", async () => {
        const lines: SafeHtml[] = [
          html`<b>Brand Stewardship — ${periodMonth} prepared</b>`,
          html`Onward-active brands: <b>${aggregated.size}</b> · clone-active brands: <b>${cloneLedger.size}</b>`,
          html`Reports prepared (have contact): <b>${prepared.prepared}</b>`,
          html`…of which carry clone detections: <b>${prepared.clones_attached}</b>`,
          html`…of which carry Reddit mentions: <b>${prepared.reddit_attached}</b> (reddit-active brands: ${redditAgg.size})`,
          html`Skipped (no known_brands contact): ${prepared.skipped_no_contact}`,
        ];
        if (clonesFromStore.storeRows.length === 0) {
          // Loud, not silent: an empty store is either a month with no clones
          // (never, in practice) or a manual run before report-summary wrote it.
          lines.push(
            html`⚠️ <b>Monthly clone store has 0 rows for ${periodMonth}</b> — clone section empty. Run clone-watch/report-summary.manual-trigger.v1 first.`,
          );
        } else if (clonesFromStore.unreadMembers > 0) {
          lines.push(
            html`⚠️ ${clonesFromStore.unreadMembers} member alert(s) no longer readable — counts kept, watch-list shorter`,
          );
        }
        if (prepared.failed > 0) {
          lines.push(
            html`⚠️ <b>${prepared.failed} report row(s) failed to write</b> — see brand-stewardship logs`,
          );
        }
        // Manual-outreach nudge: clone-targeted brands we can't email (no contact).
        if (prepared.no_contact_clone_brands > 0) {
          lines.push(
            html``,
            html`⚠️ <b>${prepared.no_contact_clone_brands} clone-targeted brand(s) have NO security contact</b> — manual outreach (security.txt / LinkedIn):`,
            ...prepared.no_contact_top.map(
              (b) =>
                html`· ${b.domain} — ${b.count} clone${b.count === 1 ? "" : "s"}`,
            ),
          );
        }
        lines.push(html``, html`Review + send at askarthur.au/admin/brand-stewardship`);
        await sendAdminTelegramMessage(joinHtml(lines, "\n"));
      });

      await step.run("log-outcome", () =>
        recordLaneOutcome("report-brand-stewardship", prepared.prepared, {
          prepared: prepared.prepared,
          failed: prepared.failed,
          clone_brands: cloneLedger.size,
          period: periodMonth,
        }),
      );

      logger.info("brand-stewardship: complete", {
        period: periodMonth,
        onwardBrands: aggregated.size,
        cloneBrands: cloneLedger.size,
        storeFrozenAt: clonesFromStore.frozenAt,
        ...prepared,
      });

      return {
        ok: true,
        period: periodMonth,
        onward_brands: aggregated.size,
        clone_brands: cloneLedger.size,
        store_frozen_at: clonesFromStore.frozenAt,
        ...prepared,
      };
    },
  ),
);
