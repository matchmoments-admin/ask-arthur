import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { inngest } from "@askarthur/scam-engine/inngest/client";

// Shared onward-report submit core — the single source of truth for turning a
// resolved (destination, destination_key) list into logged `onward_report_log`
// rows + fired per-destination Inngest workers. Extracted from
// app/api/report/onward/route.ts so BOTH the web route AND the bot
// "Report scam" flow drive the exact same pipeline (the routing brain), rather
// than the bots forking a parallel reporter. The route keeps the HTTP concerns
// (rate-limit, zod parse, status mapping); everything below is transport-free.

/** Canonical onward destinations. `z.enum(ONWARD_DEST_VALUES)` in the route
 *  validates the wire shape against this same list (no drift). */
export const ONWARD_DEST_VALUES = [
  "scamwatch",
  "reportcyber",
  "acma_email_spam",
  "idcare",
  "brand_abuse",
  "ask_arthur_feed",
  "openphish",
  "apwg",
] as const;

export type OnwardDestEnum = (typeof ONWARD_DEST_VALUES)[number];

export interface SelectedDestination {
  destination: OnwardDestEnum;
  destination_key: string;
}

export const ONWARD_DISPLAY: Record<OnwardDestEnum, string> = {
  scamwatch: "Scamwatch",
  reportcyber: "ReportCyber",
  acma_email_spam: "ACMA spam intake",
  idcare: "IDCARE",
  brand_abuse: "Brand security team",
  ask_arthur_feed: "Ask Arthur threat feed",
  openphish: "OpenPhish blocklist",
  apwg: "APWG eCrime Exchange",
};

// Canonical destination_key per fixed destination. Mirrors
// get_onward_destinations() (v119) + the OpenPhish/APWG workers (v165). A
// submitted key for any non-brand destination MUST equal this exact value, so
// a caller can't fan out volume by varying the free-text key. brand_abuse keys
// are validated dynamically against active known_brands.
export const FIXED_DESTINATION_KEYS: Record<
  Exclude<OnwardDestEnum, "brand_abuse">,
  string
> = {
  scamwatch: "scamwatch.gov.au",
  reportcyber: "cyber.gov.au",
  acma_email_spam: "report@submit.spam.acma.gov.au",
  idcare: "idcare.org",
  ask_arthur_feed: "askarthur.au",
  openphish: "report@openphish.com",
  apwg: "reportphishing@apwg.org",
};

export interface OnwardResultRow {
  destination: OnwardDestEnum;
  destination_key: string;
  display_name: string;
  status: string;
}

export type SubmitOnwardOutcome =
  | { ok: true; results: OnwardResultRow[] }
  | {
      ok: false;
      status: 400 | 404 | 503;
      error: string;
      detail?: Record<string, unknown>;
    };

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

function brandDisplay(
  sel: SelectedDestination,
  impersonatedBrand: string | null,
): string | null {
  if (sel.destination !== "brand_abuse") return null;
  if (impersonatedBrand) return `${impersonatedBrand} security team`;
  return sel.destination_key
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

/**
 * Log + dispatch a resolved onward-destination selection for a scam report.
 * Idempotent per (scam_report_id, destination, destination_key) via the dedup
 * unique index; a previously-FAILED row is re-driven, terminal/in-flight rows
 * are returned as-is. Never throws — returns a typed outcome the caller maps to
 * an HTTP status (route) or a chat reply (bot).
 */
export async function submitOnwardReports(
  supabase: ServiceClient,
  input: {
    scamReportId: number;
    analysisId?: string | null;
    selected: SelectedDestination[];
  },
): Promise<SubmitOnwardOutcome> {
  const { scamReportId, selected } = input;
  const analysisId = input.analysisId ?? null;

  // Confirm the scam_report exists. The Inngest worker reloads content from the
  // canonical row; we only need existence + the impersonated brand for display.
  const { data: report, error: reportErr } = await supabase
    .from("scam_reports")
    .select("id, scam_type, impersonated_brand")
    .eq("id", scamReportId)
    .maybeSingle();
  if (reportErr || !report) {
    return { ok: false, status: 404, error: "Report not found" };
  }

  // Validate destination_key per destination so a caller can't fan out volume
  // with arbitrary free-text keys. Fixed destinations must use their canonical
  // key; brand_abuse keys must match an active known_brands.brand_key.
  const brandKeys = selected
    .filter((s) => s.destination === "brand_abuse")
    .map((s) => s.destination_key);
  let validBrandKeys = new Set<string>();
  if (brandKeys.length > 0) {
    const { data: brands } = await supabase
      .from("known_brands")
      .select("brand_key")
      .eq("is_active", true)
      .in("brand_key", brandKeys);
    validBrandKeys = new Set((brands ?? []).map((b) => b.brand_key as string));
  }
  for (const sel of selected) {
    const allowed =
      sel.destination === "brand_abuse"
        ? validBrandKeys.has(sel.destination_key)
        : FIXED_DESTINATION_KEYS[sel.destination] === sel.destination_key;
    if (!allowed) {
      return {
        ok: false,
        status: 400,
        error: "invalid_destination",
        detail: {
          destination: sel.destination,
          destination_key: sel.destination_key,
        },
      };
    }
  }

  const impersonatedBrand = report.impersonated_brand as string | null;
  const results: OnwardResultRow[] = [];

  // Fire a destination worker's event. On success the row stays 'queued' (the
  // worker moves it to a terminal status); on failure we mark it 'failed' so it
  // is distinguishable from a queued-but-unprocessed row and re-drivable on
  // resubmit (2026-07-12 fleet-review convergence rule).
  const fireEvent = async (
    logId: string,
    sel: SelectedDestination,
  ): Promise<"queued" | "failed"> => {
    try {
      await inngest.send({
        name: `report.onward.${sel.destination}` as const,
        data: {
          log_id: logId,
          scam_report_id: scamReportId,
          destination_key: sel.destination_key,
          analysis_id: analysisId,
        },
      });
      return "queued";
    } catch (err) {
      logger.error("inngest.send for onward report failed", {
        error: String(err),
        destination: sel.destination,
      });
      await supabase
        .from("onward_report_log")
        .update({ status: "failed" })
        .eq("id", logId);
      return "failed";
    }
  };

  for (const sel of selected) {
    const display_name =
      brandDisplay(sel, impersonatedBrand) ?? ONWARD_DISPLAY[sel.destination];

    const { data: existing } = await supabase
      .from("onward_report_log")
      .select("id, status")
      .eq("scam_report_id", scamReportId)
      .eq("destination", sel.destination)
      .eq("destination_key", sel.destination_key)
      .maybeSingle();

    if (existing) {
      // Re-drive a previously-FAILED send so a resubmit self-heals it; a queued
      // row is NOT re-fired (its event already emitted — avoid a double send).
      let status = existing.status as string;
      if (existing.status === "failed") {
        status = await fireEvent(existing.id, sel);
        if (status === "queued") {
          await supabase
            .from("onward_report_log")
            .update({ status: "queued" })
            .eq("id", existing.id);
        }
      }
      results.push({
        destination: sel.destination,
        destination_key: sel.destination_key,
        display_name,
        status,
      });
      continue;
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("onward_report_log")
      .insert({
        scam_report_id: scamReportId,
        analysis_id: analysisId,
        destination: sel.destination,
        destination_key: sel.destination_key,
        status: "queued",
        provider: "inngest",
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      logger.error("onward_report_log insert failed", {
        error: String(insertErr),
        destination: sel.destination,
      });
      results.push({
        destination: sel.destination,
        destination_key: sel.destination_key,
        display_name,
        status: "failed",
      });
      continue;
    }

    const status = await fireEvent(inserted.id, sel);
    results.push({
      destination: sel.destination,
      destination_key: sel.destination_key,
      display_name,
      status,
    });
  }

  return { ok: true, results };
}
