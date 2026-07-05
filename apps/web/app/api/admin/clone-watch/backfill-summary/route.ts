import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { logger } from "@askarthur/utils/logger";

// Admin-triggered backfill of the monthly Clone Watch snapshot + trend rows.
// Emits the same clone-watch/report-summary.manual-trigger.v1 event the cron
// uses, so the deployed clone-watch-report-summary Inngest fn recomputes the
// summary (v189) AND the per-brand/registrar trend rows (v193) for the given
// month. This is the click-behind-admin-auth way to backfill a historical
// month (e.g. June 2026) without touching the Inngest dashboard or the event
// key. Idempotent: the fn upserts the summary and delete-then-inserts trends.

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  // Optional; the fn defaults to the prior calendar month when omitted.
  periodMonth: z.string().regex(/^\d{4}-\d{2}$/, "expected YYYY-MM").optional(),
});

export async function POST(req: Request) {
  await requireAdmin();

  if (!featureFlags.shopfrontCloneOutreach) {
    return NextResponse.json({ error: "clone_outreach_disabled" }, { status: 503 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_period" }, { status: 400 });
  }
  const periodMonth = parsed.data.periodMonth;

  try {
    await inngest.send({
      name: "clone-watch/report-summary.manual-trigger.v1",
      // Unique id per manual trigger so the fn's event-dedup doesn't swallow a
      // deliberate re-run of the same month.
      id: `clone-watch-report-summary-admin:${periodMonth ?? "prior"}:${Date.now()}`,
      data: periodMonth ? { periodMonth } : {},
    });
  } catch (err) {
    logger.error("clone-watch backfill-summary send failed", { error: String(err) });
    return NextResponse.json({ error: "enqueue_failed" }, { status: 502 });
  }

  return NextResponse.json(
    { ok: true, period: periodMonth ?? "prior-month" },
    { status: 202 },
  );
}
