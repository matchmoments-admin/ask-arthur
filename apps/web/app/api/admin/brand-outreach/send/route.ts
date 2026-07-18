import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Resend } from "resend";
import { render } from "@react-email/components";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { readStringEnv } from "@askarthur/utils/env";
import { logger } from "@askarthur/utils/logger";
import { logCost, PRICING } from "@/lib/cost-telemetry";
import { signUnsubscribeUrl } from "@/lib/unsubscribe";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import { renderCopySlot } from "@/lib/email/resolve-copy";
import { outreachIdempotencyKey } from "@/lib/email/brand-outreach";
import { getBrandCloneSample } from "@/lib/email/brand-outreach-pilot";
import BrandOutreachPilot from "@/emails/BrandOutreachPilot";

export const dynamic = "force-dynamic";

const UNSUBSCRIBE_BASE = "https://askarthur.au/unsubscribe";

// The Zod key name is verbose on purpose — the field carries the founder's
// own prose (light markdown), which the email builder sanitises before it is
// sent externally.
const Body = z.object({
  to: z.string().email(),
  brandName: z.string().trim().min(1).max(120),
  // Optional stable brand key (the worklist's brand_key = the brand's legit
  // domain). Recorded on the outreach-log row so "next brand" knows this brand
  // was contacted. Absent for ad-hoc sends not driven by the worklist.
  brandKey: z.string().trim().min(1).max(200).optional(),
  subject: z.string().trim().min(1).max(200),
  bodyMarkdown_or_html: z.string().trim().min(1).max(20_000),
  testMode: z.boolean().optional(),
});

/**
 * Best-effort insert into the brand_outreach_log ledger. Never throws — the
 * email has already been sent (or failed) by the time this runs, so a ledger
 * hiccup must not change the caller's outcome. It only affects the worklist's
 * already-contacted memory, which is self-healing on the next send.
 */
async function recordOutreach(row: {
  brandKey?: string;
  brandName: string;
  recipient: string;
  subject: string;
  mode: "real" | "shadow";
  status: "sent" | "failed";
  providerMessageId?: string | null;
}): Promise<void> {
  try {
    const sb = createServiceClient();
    if (!sb) return;
    const { error } = await sb.from("brand_outreach_log").insert({
      brand_key: row.brandKey ?? null,
      brand_name: row.brandName,
      recipient: row.recipient,
      subject: row.subject,
      mode: row.mode,
      status: row.status,
      provider_message_id: row.providerMessageId ?? null,
    });
    if (error) {
      logger.warn("brand-outreach: log insert failed", { error: String(error) });
    }
  } catch (err) {
    logger.warn("brand-outreach: log insert threw", { error: String(err) });
  }
}

/**
 * POST /api/admin/brand-outreach/send — send ONE founder-composed cold
 * outreach / pilot email to a SINGLE brand contact.
 *
 * This is the manual "four-eyes" path: a human founder pastes the recipient
 * and writes the body, then sends. It is legally distinct from the automated
 * brand-stewardship report send (which is flag-gated on #371 legal sign-off)
 * — a person authored and approved every word here, so there is no bulk loop
 * and no per-brand auto-send.
 *
 * Recipient routing (mirrors the stewardship route's validation-first shape):
 *   • testMode === true            → shadow send to the founder's own inbox.
 *   • BRAND_OUTREACH_SHADOW_RECIPIENT set → ALL sends are shadowed to that
 *     inbox regardless of testMode (a hard belt-and-braces during setup).
 *   • otherwise                    → REAL external send to `to`.
 *
 * Strictly one recipient per request — there is no batch/loop path by design.
 */
export async function POST(req: NextRequest) {
  await requireAdmin();

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = readStringEnv("RESEND_FROM_EMAIL");
  if (!apiKey || !fromEmail) {
    logger.error("brand-outreach send: RESEND env unset", {
      hasFrom: Boolean(fromEmail),
      hasKey: Boolean(apiKey),
    });
    return NextResponse.json({ error: "email_not_configured" }, { status: 503 });
  }

  // Resolve the shadow inbox — the operator's own address. A configured
  // BRAND_OUTREACH_SHADOW_RECIPIENT forces every send to the shadow inbox
  // (safety valve); otherwise testMode alone routes to the founder inbox.
  const shadowEnv = readStringEnv("BRAND_OUTREACH_SHADOW_RECIPIENT");
  const founderInbox =
    shadowEnv || readStringEnv("ADMIN_TEST_EMAIL") || "brendan@askarthur.au";
  const isShadow = body.testMode === true || Boolean(shadowEnv);
  const recipient = isShadow ? founderInbox : body.to;

  // Shadow sends are prefixed so the founder can tell a self-test from a real
  // thread in their own inbox; the REAL send carries the founder's subject
  // verbatim (it's a personal email — no marketing prefix).
  const subject = isShadow ? `[TEST → ${body.brandName}] ${body.subject}` : body.subject;

  // Signed one-click unsubscribe (RFC 8058) + a mailto STOP fallback. Bound to
  // the ACTUAL recipient so a shadow test unsubscribes the founder, not the
  // brand. The stable idempotencyKey (recipient+subject+day) means a
  // double-click never double-sends.
  const unsubscribeUrl = signUnsubscribeUrl(recipient, UNSUBSCRIBE_BASE);
  const stopMailto = `mailto:brendan@askarthur.au?subject=${encodeURIComponent(
    `STOP — ${body.brandName}`,
  )}`;
  const idempotencyKey = outreachIdempotencyKey(recipient, subject);

  // Pull the real clone-detection sample so the pilot email PROVES the value:
  // a styled table of the lookalikes we detected + reported for this brand in
  // the last 30 days. Keyed by the worklist brandKey (== the brand's legit
  // domain == inferred_target_domain). Best-effort — a null sample (no brandKey,
  // no service client, or a query error) simply drops the sample section; the
  // pitch + signature still send.
  const sampleClient = createServiceClient();
  const cloneSample = sampleClient
    ? await getBrandCloneSample(sampleClient, body.brandKey)
    : null;

  // Render the styled React Email template (multipart html + plain-text twin).
  // The founder's prose (offer + {{hook}}) is sanitised markdown → HTML via the
  // same renderer Email Studio uses, then handed to the template as the opening
  // body; the clone sample + signature are the template's own chrome.
  const bodyHtml = renderCopySlot(body.bodyMarkdown_or_html, {
    brandName: body.brandName,
  });
  const el = BrandOutreachPilot({
    brandName: body.brandName,
    bodyHtml,
    cloneSample: cloneSample ?? undefined,
    stopUrl: unsubscribeUrl,
  });
  const html = await render(el);
  const text = await render(el, { plainText: true });

  let messageId: string | null = null;
  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send(
      {
        from: fromEmail,
        to: [recipient],
        subject,
        html,
        text,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>, <${stopMailto}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      },
      { idempotencyKey },
    );
    if (result.error) {
      throw new Error(result.error.message ?? String(result.error));
    }
    messageId = result.data?.id ?? null;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("brand-outreach send: Resend rejected", {
      brand: body.brandName,
      mode: isShadow ? "shadow" : "real",
      reason,
    });
    try {
      await sendAdminTelegramMessage(
        [
          `🚨 <b>Brand outreach send FAILED</b>`,
          ``,
          `Brand: <b>${body.brandName}</b>`,
          `Recipient: <code>${recipient}</code>${isShadow ? " (shadow/test)" : " (REAL)"}`,
          `Reason: <code>${reason.slice(0, 200)}</code>`,
        ].join("\n"),
      );
    } catch (tgErr) {
      logger.error("brand-outreach send: telegram alert failed", {
        error: String(tgErr),
      });
    }
    // Record the failed attempt so the ledger reflects reality (does not count
    // as "contacted" for the worklist — only status='sent' rows do).
    await recordOutreach({
      brandKey: body.brandKey,
      brandName: body.brandName,
      recipient,
      subject,
      mode: isShadow ? "shadow" : "real",
      status: "failed",
    });
    return NextResponse.json({ error: "send_failed", detail: reason }, { status: 502 });
  }

  // Ledger the successful send — this is what the "Next brand to email"
  // worklist reads to know this brand has been contacted.
  await recordOutreach({
    brandKey: body.brandKey,
    brandName: body.brandName,
    recipient,
    subject,
    mode: isShadow ? "shadow" : "real",
    status: "sent",
    providerMessageId: messageId,
  });

  logCost({
    feature: "brand_outreach",
    provider: "resend",
    operation: "pilot",
    units: 1,
    unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
    metadata: { brand: body.brandName, mode: isShadow ? "shadow" : "real" },
  });

  // Log every send to the founder's channel — a REAL outreach in particular
  // should never happen silently.
  try {
    await sendAdminTelegramMessage(
      [
        `${isShadow ? "🧪" : "📨"} <b>Brand outreach ${isShadow ? "TEST" : "SENT"}</b>`,
        ``,
        `Brand: <b>${body.brandName}</b>`,
        `Recipient: <code>${recipient}</code>${isShadow ? " (shadow/test)" : " (REAL)"}`,
        `Subject: ${subject}`,
      ].join("\n"),
    );
  } catch (tgErr) {
    logger.error("brand-outreach send: telegram confirm failed", {
      error: String(tgErr),
    });
  }

  return NextResponse.json({
    ok: true,
    mode: isShadow ? "shadow" : "real",
    recipient,
    provider_message_id: messageId,
  });
}
