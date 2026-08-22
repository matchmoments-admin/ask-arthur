import { NextRequest, NextResponse } from "next/server";
import { inspectDocument } from "@askarthur/scam-engine/document-check";
import { checkDocumentUploadRateLimit } from "@askarthur/utils/rate-limit";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import {
  DOCUMENT_CHECK_DISCLAIMER,
  type WebDocumentCheckResponse,
} from "@askarthur/types";
import { logEvent } from "@/lib/analytics-events";
import { logCost } from "@/lib/cost-telemetry";
import { recordDocumentCheck } from "@/lib/document-check-records";

// Public document checker (/document-check page). Upload mode only — the
// deterministic structural walk plus the AU content pack: ABN checksum
// locally, ABR verification as a free/cached/braked network call. No
// classifier, no Claude, no PAID APIs. Findings are named signals
// (ADR-0015/0024 epistemics); the UI must render an empty findings list
// with the asymmetry caveat (DOCUMENT_CHECK_CLEAN_COPY), never as
// "genuine".
//
// Unauthenticated, so the budget posture is: per-IP sliding-window limit
// (5/h, fail-closed in prod) BEFORE any work; the pack's ABR lookups run
// in parallel under a per-lookup deadline (packs/au.ts) so a degraded ABR
// can't hold the function open. Bytes live only for the request
// (ADR-0010); no persistence in this stage (evidence records are the
// Stage-2 migration). `content: null` in the response means the pack did
// not run for this request — "not assessed", never "clean".

const MAX_UPLOAD_BYTES = 10_000_000; // bank statements exceed the 5 MB image cap

export async function POST(req: NextRequest) {
  try {
    const contentLength = parseInt(req.headers.get("content-length") || "0");
    if (contentLength > MAX_UPLOAD_BYTES + 50_000) {
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    }

    // Same double-gate posture as the image-check routes — the whole
    // Document Check Module is dark until NEXT_PUBLIC_FF_DOCUMENT_CHECK is on.
    if (!featureFlags.documentCheck) {
      return NextResponse.json(
        { error: "feature_disabled", message: "Document checking is not currently enabled." },
        { status: 503 },
      );
    }

    const ip =
      req.headers.get("x-real-ip") ??
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const rate = await checkDocumentUploadRateLimit(ip);
    if (!rate.allowed) {
      // A fail-closed store outage is NOT a quota hit — telling a first-time
      // user they exceeded a limit they never used is the caller mistake the
      // rate-limit module's docstring warns about. 503 + retry instead.
      if (rate.reason === "store_unavailable") {
        return NextResponse.json(
          { error: "service_unavailable", message: "Checking is briefly unavailable. Try again in a minute." },
          { status: 503, headers: { "Retry-After": "60" } },
        );
      }
      return NextResponse.json(
        { error: "rate_limited", message: rate.message ?? "Too many checks. Try again later." },
        {
          status: 429,
          headers: rate.resetAt
            ? { "Retry-After": String(Math.max(1, Math.round((rate.resetAt.getTime() - Date.now()) / 1000))) }
            : undefined,
        },
      );
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.startsWith("multipart/form-data")) {
      return NextResponse.json(
        { error: "unsupported_mode", message: "Upload a PDF file as multipart/form-data." },
        { status: 400 },
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob) || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "invalid_file", message: "Upload one PDF up to 10 MB." },
        { status: file && file instanceof Blob && file.size > MAX_UPLOAD_BYTES ? 413 : 400 },
      );
    }
    // Funnel discriminator: the standalone page vs the homepage scanner's
    // document mode share this route — allowlisted so telemetry cardinality
    // stays fixed regardless of what a client sends.
    const surface =
      form.get("surface") === "inline" ? "document_check_inline" : "document_check_web";
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return NextResponse.json(
        { error: "unsupported_file", message: "That file doesn't look like a PDF. Only PDF documents are supported for now." },
        { status: 422 },
      );
    }

    // One call on the Document Check Module's seam — the module owns the
    // summary→findings pairing, the hash, and the jurisdiction pack
    // dispatch, so this route never grows orchestration. AU-first product:
    // the AU pack (ABN checksum + ABR, free, braked) always runs here.
    const inspection = await inspectDocument(buffer, { jurisdiction: "au" });

    // Volume signal that does NOT depend on the attribution cookie: a $0
    // cost_telemetry row per check (the free-tier "units at $0" convention),
    // so the Stage-1 go/no-go gate can't read a false zero when
    // FF_ANALYTICS_ATTRIBUTION is off or the visitor blocks cookies.
    logCost({
      feature: "document_check",
      provider: "internal",
      operation: "structural-scan",
      units: 1,
      unitCostUsd: 0,
      metadata: {
        surface,
        is_pdf: inspection.structural.isPdf,
        findings: inspection.findings.length,
      },
      requestId: null,
    });

    // Attribution-funnel signal (metadata only — signal names, never content).
    void logEvent({
      eventType: "document_check_completed",
      eventProps: {
        findings: inspection.findings.length,
        signals: inspection.findings.map((f) => f.signal).join(","),
        is_pdf: inspection.structural.isPdf,
        surface,
      },
      path: "/api/document-check",
      requestId: null,
    });

    // The module admitted the magic bytes but the scan could not run (e.g. a
    // sub-8-byte stub, or a fully collapsed parse). A scan that did not run
    // must never render as the clean state — that is the asymmetry rule.
    if (!inspection.structural.isPdf) {
      const unavailable: WebDocumentCheckResponse = {
        checked: false,
        reason: "scan_unavailable",
        mode: "upload",
        docSha256: inspection.docSha256,
        structural: null,
        findings: [],
        content: null,
        disclaimer: DOCUMENT_CHECK_DISCLAIMER,
      };
      return NextResponse.json(unavailable);
    }

    const response: WebDocumentCheckResponse = {
      checked: true,
      mode: "upload",
      ...inspection,
      // Evidence record for FLAGGED checks only (ADR-0022 pattern) —
      // recordDocumentCheck owns the flag-gate and metadata-only rules,
      // and only returns a ref once the row exists.
      checkRef: await recordDocumentCheck(inspection, { source: "web" }),
      disclaimer: DOCUMENT_CHECK_DISCLAIMER,
    };
    return NextResponse.json(response);
  } catch (err) {
    logger.error("Document check error", { error: String(err) });
    return NextResponse.json(
      { error: "document_check_failed", message: "Something went wrong checking this document." },
      { status: 500 },
    );
  }
}
