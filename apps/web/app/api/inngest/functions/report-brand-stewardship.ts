import { inngest } from "@askarthur/scam-engine/inngest/client";
import { createServiceClient } from "@askarthur/supabase/server";
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

/** Match an aggregated brand string to an active known_brands email contact. */
export function matchKnownBrand(
  brand: string,
  contacts: KnownBrandContact[],
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
  return null;
}

/** First day of the prior calendar month (UTC) given a reference date. */
export function priorMonthStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0),
  );
}

export const reportBrandStewardship = inngest.createFunction(
  {
    id: "report-brand-stewardship",
    name: "Brand Stewardship: monthly report aggregation",
    retries: 2,
  },
  { cron: "0 9 1 * *" }, // 1st of month, 09:00 UTC
  async ({ step }) => {
    if (!featureFlags.brandStewardshipReport) {
      return { skipped: true, reason: "FF_BRAND_STEWARDSHIP_REPORT disabled" };
    }

    // Compute the reporting window inside a step so it's memoised across
    // Inngest replays (deterministic).
    const period = await step.run("compute-period", async () => {
      const start = priorMonthStart(new Date());
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

    if (logRows.length === 0) {
      return { ok: true, period: periodMonth, brands: 0 };
    }

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
    if (aggregated.size === 0) {
      return { ok: true, period: periodMonth, brands: 0 };
    }

    // Load active known_brands email contacts; only brands with a contact get
    // a report row (per the contact-gated scope decision).
    const contacts = await step.run("load-contacts", async () => {
      const sb = createServiceClient();
      if (!sb) return [] as KnownBrandContact[];
      const { data } = await sb
        .from("known_brands")
        .select("brand_key, brand_name, security_contact_email")
        .eq("is_active", true)
        .eq("contact_type", "email")
        .not("security_contact_email", "is", null);
      return (data ?? []) as KnownBrandContact[];
    });

    const prepared = await step.run("upsert-reports", async () => {
      const sb = createServiceClient();
      if (!sb) return { prepared: 0, skipped_no_contact: 0 };

      // Never clobber a report already sent for this period.
      const { data: sentRows } = await sb
        .from("brand_stewardship_reports")
        .select("brand_key")
        .eq("period_month", periodMonth)
        .eq("status", "sent");
      const alreadySent = new Set(
        (sentRows ?? []).map((r) => r.brand_key as string),
      );

      let preparedCount = 0;
      let skippedNoContact = 0;
      const nowIso = new Date().toISOString();

      for (const [brand, m] of aggregated) {
        const contact = matchKnownBrand(brand, contacts);
        if (!contact || !contact.security_contact_email) {
          skippedNoContact += 1;
          continue;
        }
        const brandKey = (contact.brand_key || deriveBrandKey(brand)).toLowerCase();
        if (alreadySent.has(brandKey)) continue;

        const { error } = await sb.from("brand_stewardship_reports").upsert(
          {
            brand_key: brandKey,
            brand_name: contact.brand_name,
            period_month: periodMonth,
            metrics: {
              detected: m.detected,
              reported_by_destination: m.reportedByDestination,
              reports_sent: m.reportsSent,
            },
            evidence_scam_report_ids: m.scamReportIds,
            recipient_email: contact.security_contact_email,
            status: "prepared",
            prepared_at: nowIso,
          },
          { onConflict: "brand_key,period_month" },
        );
        if (error) {
          logger.error("brand-stewardship: upsert failed", {
            brandKey,
            period: periodMonth,
            error: error.message,
          });
          continue;
        }
        preparedCount += 1;
      }
      return { prepared: preparedCount, skipped_no_contact: skippedNoContact };
    });

    await step.run("telegram-digest", async () => {
      await sendAdminTelegramMessage(
        [
          `<b>Brand Stewardship — ${periodMonth} prepared</b>`,
          `Brands with activity: <b>${aggregated.size}</b>`,
          `Reports prepared (have contact): <b>${prepared.prepared}</b>`,
          `Skipped (no known_brands contact): ${prepared.skipped_no_contact}`,
          `Review + send at askarthur.au/admin/brand-stewardship`,
        ].join("\n"),
      );
    });

    logger.info("brand-stewardship: complete", {
      period: periodMonth,
      brandsWithActivity: aggregated.size,
      ...prepared,
    });

    return {
      ok: true,
      period: periodMonth,
      brands: aggregated.size,
      ...prepared,
    };
  },
);
