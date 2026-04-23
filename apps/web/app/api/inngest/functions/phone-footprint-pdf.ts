import "server-only";

// Inngest function: phone-footprint/pdf.render.v1
//
// Triggered by POST /api/phone-footprint/[id]/pdf — renders the footprint
// to PDF, uploads to R2, emails the signed URL to the user. Lives in
// apps/web (not @askarthur/scam-engine/inngest) because it crosses two
// app-scoped primitives: R2 upload (apps/web/lib/r2) and Resend email
// delivery. The scam-engine package stays framework-free; app-layer
// concerns live here.
//
// Registered via apps/web/app/api/inngest/route.ts alongside the existing
// engine-side Inngest functions.

import { inngest } from "@askarthur/scam-engine/inngest/client";
import { renderFootprintPdf } from "@askarthur/scam-engine/phone-footprint";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { uploadFootprintPdf, getFootprintPdfUrl } from "@/lib/r2";
import { Resend } from "resend";
import { logCost, PRICING } from "@/lib/cost-telemetry";
import type { Footprint } from "@askarthur/scam-engine/phone-footprint";

export const PHONE_FOOTPRINT_PDF_EVENT = "phone-footprint/pdf.render.v1" as const;

interface EventData {
  footprintId: number;
  userId: string | null;
  recipientEmail: string;
  requestId?: string | null;
}

/**
 * Pull a Footprint snapshot back into Footprint-shape from phone_footprints row.
 * Column-to-field mapping matches orchestrator.persistFootprint's insert.
 */
async function loadFootprint(
  footprintId: number,
): Promise<Footprint | null> {
  const supa = createServiceClient();
  if (!supa) return null;

  const { data, error } = await supa
    .from("phone_footprints")
    .select(
      "id, msisdn_e164, msisdn_hash, tier_generated, composite_score, band, pillar_scores, coverage, providers_used, explanation, generated_at, expires_at, request_id",
    )
    .eq("id", footprintId)
    .maybeSingle();

  if (error) {
    logger.warn("phone-footprint-pdf loadFootprint error", { error: String(error.message), footprintId });
    return null;
  }
  if (!data) return null;

  return {
    msisdn_e164: data.msisdn_e164 as string,
    msisdn_hash: data.msisdn_hash as string,
    tier: data.tier_generated as Footprint["tier"],
    composite_score: data.composite_score as number,
    band: data.band as Footprint["band"],
    pillars: data.pillar_scores as Footprint["pillars"],
    coverage: data.coverage as Footprint["coverage"],
    providers_used: data.providers_used as string[],
    explanation: data.explanation as string | null,
    generated_at: data.generated_at as string,
    expires_at: data.expires_at as string,
    request_id: data.request_id as string | undefined,
  };
}

export const phoneFootprintPdfRender = inngest.createFunction(
  {
    id: "phone-footprint-pdf-render",
    name: "Phone Footprint: render + email PDF",
    // Dedup on the requestId (or a composite if absent) so a Stripe retry
    // or user double-click doesn't double-render + double-charge Resend.
    idempotency: "event.data.requestId || event.data.footprintId",
    retries: 1,
    concurrency: { limit: 5 },
  },
  { event: PHONE_FOOTPRINT_PDF_EVENT },
  async ({ event, step }) => {
    const data = event.data as EventData;

    const footprint = await step.run("load-footprint", () =>
      loadFootprint(data.footprintId),
    );
    if (!footprint) {
      return { skipped: true, reason: "footprint_not_found", footprintId: data.footprintId };
    }

    // Anonymised footprints have msisdn_e164 === 'REDACTED' after retention
    // sweep; generating a PDF for one is pointless. Skip politely.
    if (footprint.msisdn_e164 === "REDACTED") {
      return { skipped: true, reason: "footprint_anonymised", footprintId: data.footprintId };
    }

    const pdfBuffer = await step.run("render-pdf", async () => {
      const buf = await renderFootprintPdf(footprint, {
        recipientEmail: data.recipientEmail,
      });
      return buf.toString("base64"); // Inngest step results are JSON-serialised
    });

    const r2Key = await step.run("upload-r2", async () => {
      const buf = Buffer.from(pdfBuffer, "base64");
      return uploadFootprintPdf(buf, data.footprintId);
    });
    if (!r2Key) {
      return { error: "r2_upload_failed", footprintId: data.footprintId };
    }

    const signedUrl = await step.run("signed-url", () =>
      getFootprintPdfUrl(r2Key, 86_400), // 24 hours so users have time to click
    );
    if (!signedUrl) {
      return { error: "signed_url_failed", r2Key };
    }

    // Email delivery via Resend. Runs as its own step so an email failure
    // doesn't waste the PDF render work — the R2 object persists and a
    // manual re-send is a cheap fix.
    await step.run("email", async () => {
      const apiKey = process.env.RESEND_API_KEY;
      const fromEmail = process.env.RESEND_FROM_EMAIL;
      if (!apiKey || !fromEmail) {
        logger.warn("phone-footprint-pdf email skipped — RESEND envs missing");
        return;
      }
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from: fromEmail,
        to: data.recipientEmail,
        subject: `Your Phone Footprint report — ${footprint.msisdn_e164}`,
        html: emailBody(footprint, signedUrl),
      });
      logCost({
        feature: "phone_footprint",
        provider: "resend",
        operation: "pdf_email",
        units: 1,
        unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
        metadata: { footprintId: data.footprintId, r2Key },
        userId: data.userId,
        requestId: data.requestId ?? null,
      });
    });

    return { ok: true, footprintId: data.footprintId, r2Key };
  },
);

function emailBody(footprint: Footprint, signedUrl: string): string {
  return `
<!doctype html>
<html>
  <body style="font-family: system-ui, -apple-system, sans-serif; color: #0F172A; max-width: 600px; margin: 0 auto; padding: 24px;">
    <h1 style="font-size: 20px; margin-bottom: 8px;">Your Phone Footprint report</h1>
    <p style="color: #475569; margin-top: 0;">
      ${footprint.msisdn_e164} · Generated ${new Date(footprint.generated_at).toLocaleString("en-AU")}
    </p>
    <p style="margin-top: 24px;">
      Your PDF report is ready. The download link is active for 24 hours.
    </p>
    <p style="margin: 24px 0;">
      <a href="${signedUrl}" style="display: inline-block; background: #0F172A; color: white; padding: 10px 16px; border-radius: 8px; text-decoration: none;">
        Download PDF
      </a>
    </p>
    <p style="color: #64748B; font-size: 12px; margin-top: 32px;">
      Composite score: ${footprint.composite_score}/100 (${footprint.band})<br/>
      Sources: ${footprint.providers_used.join(", ") || "none"}
    </p>
  </body>
</html>`;
}
