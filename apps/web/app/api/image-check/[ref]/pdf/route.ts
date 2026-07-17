import { NextRequest, NextResponse } from "next/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { renderEvidencePdf } from "@askarthur/scam-engine/image-check-pdf";
import { CHECK_REF_PATTERN } from "@/lib/check-ref";

// One-page evidence PDF for a flagged image check (image-check v2 PR 5).
// Public, keyed on the unguessable check ref (ADR-0022). Rendered
// synchronously — a single A4 page is sub-second on the Node runtime; the
// PDF is never stored.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  try {
    if (!featureFlags.imageCheck || !featureFlags.imageCheckRecords) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const { ref } = await params;
    if (!CHECK_REF_PATTERN.test(ref)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const supabase = createServiceClient();
    if (!supabase) {
      return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
    }

    const { data: record } = await supabase
      .from("image_check_records")
      .select(
        "check_ref, checked_at, image_url, page_url, image_sha256, ai_confidence, deepfake_confidence, generator_source, generator_breakdown, content_credentials, vision_summary, impersonated_brand, impersonated_celebrity",
      )
      .eq("check_ref", ref)
      .maybeSingle();
    if (!record) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const pdf = await renderEvidencePdf({
      checkRef: record.check_ref as string,
      checkedAt: new Date(record.checked_at as string).toISOString(),
      imageUrl: (record.image_url as string | null) ?? null,
      pageUrl: (record.page_url as string | null) ?? null,
      imageSha256: (record.image_sha256 as string | null) ?? null,
      aiConfidence:
        record.ai_confidence === null ? null : Number(record.ai_confidence),
      deepfakeConfidence:
        record.deepfake_confidence === null
          ? null
          : Number(record.deepfake_confidence),
      generatorSource: (record.generator_source as string | null) ?? null,
      generatorBreakdown:
        (record.generator_breakdown as Array<{ class: string; score: number }> | null) ??
        null,
      contentCredentials:
        (record.content_credentials as { present: boolean; format?: string } | null) ??
        null,
      visionSummary: (record.vision_summary as string | null) ?? null,
      impersonatedBrand: (record.impersonated_brand as string | null) ?? null,
      impersonatedCelebrity:
        (record.impersonated_celebrity as string | null) ?? null,
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="askarthur-evidence-${ref}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    logger.error("evidence pdf render error", { error: String(err) });
    return NextResponse.json({ error: "pdf_failed" }, { status: 500 });
  }
}
