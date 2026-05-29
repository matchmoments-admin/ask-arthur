import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
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

  type ResultRow = {
    destination: DestEnum;
    destination_key: string;
    display_name: string;
    status: string;
  };
  const results: ResultRow[] = [];

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
      results.push({
        destination: sel.destination,
        destination_key: sel.destination_key,
        display_name: brandDisplay(sel, report.impersonated_brand) ?? DISPLAY[sel.destination],
        status: existing.status,
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

    // Fire the Inngest event — name maps 1:1 to a registered worker.
    try {
      await inngest.send({
        name: `report.onward.${sel.destination}` as const,
        data: {
          log_id: inserted.id,
          scam_report_id: body.scam_report_id,
          destination_key: sel.destination_key,
          analysis_id: body.analysis_id ?? null,
        },
      });
    } catch (err) {
      logger.error("inngest.send for onward report failed", {
        error: String(err),
        destination: sel.destination,
      });
      // The log row remains 'queued' — the next manual replay or
      // queue-sweeper can pick it up.
    }

    results.push({
      destination: sel.destination,
      destination_key: sel.destination_key,
      display_name: brandDisplay(sel, report.impersonated_brand) ?? DISPLAY[sel.destination],
      status: "queued",
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
