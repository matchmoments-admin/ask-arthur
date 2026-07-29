import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import {
  submitOnwardReports,
  ONWARD_DEST_VALUES,
} from "@/lib/onward/submit";

const Body = z.object({
  /**
   * The capability handle from /api/analyze (`analysisRef`), persisted as
   * scam_reports.idempotency_key. REQUIRED — see the ownership note on POST.
   */
  analysis_ref: z.string().min(1).max(128),
  analysis_id: z.string().max(128).optional(),
  selected: z
    .array(
      z.object({
        destination: z.enum(ONWARD_DEST_VALUES),
        destination_key: z.string().min(1).max(200),
      })
    )
    .min(1)
    .max(20),
});

/**
 * POST /api/report/onward
 *
 * Thin HTTP wrapper over submitOnwardReports (lib/onward/submit.ts) — the shared
 * routing-brain core that logs onward_report_log rows and fires the per-
 * destination Inngest workers. The dedup unique index on (scam_report_id,
 * destination, destination_key) makes replay safe. The bot "Report scam" flow
 * calls submitOnwardReports directly, so both surfaces share one pipeline.
 *
 * OWNERSHIP (2026-07-29): this route used to accept a raw
 * `scam_report_id: number` from the client with no check that the caller had
 * anything to do with that report. Report ids are sequential integers, so
 * anyone could have filed regulator and brand reports against any report in
 * the table by counting from 1. It was unexploited only because the UI that
 * calls it could never render (see /api/report/by-ref), which means wiring
 * that UI up is exactly what would have made it reachable — so it is fixed in
 * the same change.
 *
 * The caller now presents `analysis_ref` — the ULID handed back by
 * /api/analyze, carrying 80 bits of randomness — and the server resolves it to
 * the id. Holding the ref is the authorisation: it is issued only to whoever
 * submitted the analysis. No numeric id is accepted from the client at all,
 * so there is nothing left to enumerate.
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
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  // Resolve the capability handle to the report it owns. A miss is either a
  // forged ref or a durable write that has not landed yet; both are a 404, and
  // neither distinguishes "wrong ref" from "not ready" to the caller.
  const { data: report, error: lookupError } = await supabase
    .from("scam_reports")
    .select("id")
    .eq("idempotency_key", body.analysis_ref)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!report) {
    return NextResponse.json({ error: "report_not_found" }, { status: 404 });
  }

  const outcome = await submitOnwardReports(supabase, {
    scamReportId: report.id,
    analysisId: body.analysis_id,
    selected: body.selected,
  });

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error, ...(outcome.detail ?? {}) },
      { status: outcome.status }
    );
  }

  return NextResponse.json({ ok: true, results: outcome.results });
}
