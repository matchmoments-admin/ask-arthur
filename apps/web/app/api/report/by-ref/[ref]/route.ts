import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { isValidIdempotencyKey } from "@askarthur/utils/request-id";

/**
 * GET /api/report/by-ref/[ref]
 *
 * Resolves the `analysisRef` returned by /api/analyze (the request's ULID,
 * persisted as `scam_reports.idempotency_key` in v73) to that report's numeric
 * id, so the client can attach onward reports to it.
 *
 * WHY THIS EXISTS: `/api/analyze` persists the scam_reports row asynchronously
 * — via `analyze.completed.v1` when FF_ANALYZE_INNGEST_WEB is on, or the
 * legacy `waitUntil` path when it is off. Neither has finished by the time the
 * response is serialised, so the route cannot return a numeric id inline
 * without moving a write onto the hot path. ResultCard gated its report CTA on
 * `typeof scamReportId === "number"`, which therefore never became true: the
 * onward-reporting apparatus (v119 routing brain, six per-destination Inngest
 * workers, the brand-stewardship evidence bundle) has never once run from the
 * web surface. This endpoint is the missing exchange step.
 *
 * A 404 here is normal and expected, not an error: it means the durable write
 * has not landed yet. The caller retries briefly.
 *
 * SECURITY: the ref is the caller's capability. It is unguessable in the
 * generated case (a ULID carries 80 bits of randomness), and this route
 * returns ONLY the id — never report content — so a brute-forced hit yields an
 * integer the holder must still pair with a matching ref to use downstream.
 * Deliberately no enumeration surface: exact match only, single row.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;

  // Same validation the analyze route applies when accepting a client-supplied
  // Idempotency-Key, so this route can never be used to probe the table with
  // arbitrary strings.
  if (!isValidIdempotencyKey(ref)) {
    return NextResponse.json({ error: "invalid_ref" }, { status: 400 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("scam_reports")
    .select("id")
    .eq("idempotency_key", ref)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!data) {
    // Not yet persisted — the caller should retry shortly.
    return NextResponse.json({ error: "not_ready" }, { status: 404 });
  }

  return NextResponse.json(
    { scamReportId: data.id },
    { headers: { "Cache-Control": "no-store" } },
  );
}
