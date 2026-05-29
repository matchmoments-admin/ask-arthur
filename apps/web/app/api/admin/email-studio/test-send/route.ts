import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { render } from "@react-email/components";
import { Resend } from "resend";
import { requireAdmin } from "@/lib/adminAuth";
import { readStringEnv } from "@askarthur/utils/env";
import { logger } from "@askarthur/utils/logger";
import { logCost, PRICING } from "@/lib/cost-telemetry";
import { buildPreviewElement } from "@/lib/email/preview-fixtures";
import { EMAIL_TEMPLATES } from "@/lib/email/copy-registry";

export const dynamic = "force-dynamic";

const Body = z.object({
  templateKey: z.string().min(1).max(64),
  copy: z.record(z.string(), z.string()).optional(),
});

// POST /api/admin/email-studio/test-send — render the template (sample data +
// supplied copy) and send it ONLY to the operator's own address, never a real
// recipient. Subject is prefixed [TEST].
export async function POST(req: NextRequest) {
  await requireAdmin();
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const el = buildPreviewElement(body.templateKey, body.copy);
  if (!el) return NextResponse.json({ error: "unknown_template" }, { status: 404 });

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = readStringEnv("RESEND_FROM_EMAIL");
  // Always self-only: the operator's address. Never a real recipient.
  const toEmail = readStringEnv("ADMIN_TEST_EMAIL") || "brendan@askarthur.au";
  if (!apiKey || !fromEmail) {
    return NextResponse.json({ error: "resend_not_configured" }, { status: 503 });
  }

  const html = await render(el);
  const label = EMAIL_TEMPLATES[body.templateKey]?.label ?? body.templateKey;

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: fromEmail,
      to: [toEmail],
      subject: `[TEST] ${label} — Email Studio preview`,
      html,
    });
    if (result.error) {
      throw new Error(result.error.message ?? String(result.error));
    }
    logCost({
      feature: "email",
      provider: "resend",
      operation: "email_studio_test",
      units: 1,
      unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
      metadata: { template_key: body.templateKey },
    });
    return NextResponse.json({ ok: true, to: toEmail, id: result.data?.id });
  } catch (err) {
    logger.error("email-studio test-send failed", { error: String(err) });
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }
}
