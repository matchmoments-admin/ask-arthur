import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { logger } from "@askarthur/utils/logger";
import { inngest } from "@askarthur/scam-engine/inngest/client";

const Body = z.object({
  scam_report_id: z.number().int().positive(),
  analysis_id: z.string().max(128).optional(),
  selected: z
    .array(
      z.object({
        destination: z.enum([
          "scamwatch",
          "reportcyber",
          "acma_email_spam",
          "idcare",
          "brand_abuse",
          "ask_arthur_feed",
          "openphish",
          "apwg",
        ]),
        destination_key: z.string().min(1).max(200),
      })
    )
    .min(1)
    .max(20),
});

type DestEnum = z.infer<typeof Body>["selected"][number]["destination"];

const DISPLAY: Record<DestEnum, string> = {
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
// an anonymous caller can't fan out volume by varying the free-text key.
// brand_abuse keys are validated dynamically against active known_brands.
const FIXED_DESTINATION_KEYS: Record<Exclude<DestEnum, "brand_abuse">, string> = {
  scamwatch: "scamwatch.gov.au",
  reportcyber: "cyber.gov.au",
  acma_email_spam: "report@submit.spam.acma.gov.au",
  idcare: "idcare.org",
  ask_arthur_feed: "askarthur.au",
  openphish: "report@openphish.com",
  apwg: "reportphishing@apwg.org",
};

/**
 * POST /api/report/onward
 *
 * Inserts queued rows into onward_report_log for each (destination,
 * destination_key) tuple, then fires Inngest events that the destination
 * workers consume. The dedup unique index on (scam_report_id, destination,
 * destination_key) makes replay safe: a second submission of the same
 * tuple no-ops with the existing log row's status.
 */
export async function POST(req: NextRequest) {
  // Rate limit (mirrors scam-contacts/report): this route fans out to external
  // regulator/brand intakes, so cap per-IP submissions even for anonymous use.
  const ip =
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const rateCheck = await checkFormRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: rateCheck.message },
      { status: 429 }
    );
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid request", details: String(err) },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service unavailable" },
      { status: 503 }
    );
  }

  // Confirm the scam_report exists. We don't need to read its content here —
  // the Inngest worker reloads it from the canonical row.
  const { data: report, error: reportErr } = await supabase
    .from("scam_reports")
    .select("id, scam_type, impersonated_brand")
    .eq("id", body.scam_report_id)
    .maybeSingle();
  if (reportErr || !report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // Validate destination_key per destination so a caller can't fan out volume
  // with arbitrary free-text keys. Fixed destinations must use their canonical
  // key; brand_abuse keys must match an active known_brands.brand_key.
  const brandKeys = body.selected
    .filter((s) => s.destination === "brand_abuse")
    .map((s) => s.destination_key);
  let validBrandKeys = new Set<string>();
  if (brandKeys.length > 0) {
    const { data: brands } = await supabase
      .from("known_brands")
      .select("brand_key")
      .eq("is_active", true)
      .in("brand_key", brandKeys);
    validBrandKeys = new Set(
      (brands ?? []).map((b) => b.brand_key as string)
    );
  }
  for (const sel of body.selected) {
    const allowed =
      sel.destination === "brand_abuse"
        ? validBrandKeys.has(sel.destination_key)
        : FIXED_DESTINATION_KEYS[sel.destination] === sel.destination_key;
    if (!allowed) {
      return NextResponse.json(
        {
          error: "invalid_destination",
          destination: sel.destination,
          destination_key: sel.destination_key,
        },
        { status: 400 }
      );
    }
  }

  type ResultRow = {
    destination: DestEnum;
    destination_key: string;
    display_name: string;
    status: string;
  };
  const results: ResultRow[] = [];

  // Fire a destination worker's event. On success the row stays 'queued' (the
  // worker moves it to a terminal status); on failure we mark it 'failed' so it
  // is (a) distinguishable from a successfully-queued-but-unprocessed row and
  // (b) re-drivable on resubmit. Leaving a send-failed row 'queued' made it
  // permanently stuck — no stage reads WHERE status='queued' to re-drive it
  // (2026-07-12 fleet-review convergence gap: a re-submit path must move the
  // row back across the predicate its consumer filters on).
  const fireEvent = async (
    logId: string,
    sel: (typeof body.selected)[number],
  ): Promise<"queued" | "failed"> => {
    try {
      await inngest.send({
        name: `report.onward.${sel.destination}` as const,
        data: {
          log_id: logId,
          scam_report_id: body.scam_report_id,
          destination_key: sel.destination_key,
          analysis_id: body.analysis_id ?? null,
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

  for (const sel of body.selected) {
    // Check for an existing log row (dedup). If one exists, return its status
    // — don't re-fire the Inngest event.
    const { data: existing } = await supabase
      .from("onward_report_log")
      .select("id, status")
      .eq("scam_report_id", body.scam_report_id)
      .eq("destination", sel.destination)
      .eq("destination_key", sel.destination_key)
      .maybeSingle();

    if (existing) {
      // Re-drive a previously-FAILED send (the event never emitted) so a
      // resubmit self-heals it — move the row back across the worker's event
      // trigger. Terminal/in-flight statuses are returned as-is. A 'queued' row
      // is deliberately NOT re-fired here: its event was already emitted, so
      // re-firing could double an external send (a stale-'queued' sweeper that
      // respects worker idempotency is tracked separately).
      let status = existing.status;
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
        display_name: brandDisplay(sel, report.impersonated_brand) ?? DISPLAY[sel.destination],
        status,
      });
      continue;
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("onward_report_log")
      .insert({
        scam_report_id: body.scam_report_id,
        analysis_id: body.analysis_id ?? null,
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
        display_name: brandDisplay(sel, report.impersonated_brand) ?? DISPLAY[sel.destination],
        status: "failed",
      });
      continue;
    }

    // Fire the Inngest event — name maps 1:1 to a registered worker. On a send
    // failure fireEvent marks the row 'failed' (not left silently 'queued').
    const status = await fireEvent(inserted.id, sel);

    results.push({
      destination: sel.destination,
      destination_key: sel.destination_key,
      display_name: brandDisplay(sel, report.impersonated_brand) ?? DISPLAY[sel.destination],
      status,
    });
  }

  return NextResponse.json({ ok: true, results });
}

function brandDisplay(
  sel: { destination: DestEnum; destination_key: string },
  impersonatedBrand: string | null
): string | null {
  if (sel.destination !== "brand_abuse") return null;
  if (impersonatedBrand) return `${impersonatedBrand} security team`;
  // Fall back to the brand_key, prettified.
  return sel.destination_key
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
