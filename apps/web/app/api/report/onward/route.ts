import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@askarthur/supabase/server";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import {
  submitOnwardReports,
  ONWARD_DEST_VALUES,
} from "@/lib/onward/submit";

const Body = z.object({
  scam_report_id: z.number().int().positive(),
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

  const outcome = await submitOnwardReports(supabase, {
    scamReportId: body.scam_report_id,
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
