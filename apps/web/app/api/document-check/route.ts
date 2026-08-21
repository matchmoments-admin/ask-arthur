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

// Public document checker (/document-check page). Upload mode only —
// deterministic PDF structural forensics, no classifier, no Claude, no paid
// API, zero marginal cost. Findings are named signals (ADR-0015/0024
// epistemics); the UI must render an empty findings list with the asymmetry
// caveat (DOCUMENT_CHECK_CLEAN_COPY), never as "genuine".
//
// Unauthenticated, so the budget posture is: per-IP sliding-window limit
// (5/h, fail-closed in prod) BEFORE the parse — the walk is CPU-only but
// accepts 10 MB uploads. Bytes live only for the request (ADR-0010); no
// persistence in this stage (evidence records are the Stage-2 migration).
// The jurisdiction content-logic pack (ABN/BSB/arithmetic) is a follow-up
// PR — until then `content` is always null, meaning "not assessed".

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
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return NextResponse.json(
        { error: "unsupported_file", message: "That file doesn't look like a PDF. Only PDF documents are supported for now." },
        { status: 422 },
      );
    }

    // One call on the Document Check Module's seam — the module owns the
    // summary→findings pairing, the hash, and (in the follow-up PR) the
    // jurisdiction pack dispatch, so this route never grows orchestration.
    const inspection = inspectDocument(buffer);

    // Stage-1 usage signal (metadata only — signal names, never content).
    void logEvent({
      eventType: "document_check_completed",
      eventProps: {
        findings: inspection.findings.length,
        signals: inspection.findings.map((f) => f.signal).join(","),
        is_pdf: inspection.structural.isPdf,
      },
      path: "/api/document-check",
      requestId: null,
    });

    const response: WebDocumentCheckResponse = {
      checked: true,
      mode: "upload",
      ...inspection,
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
