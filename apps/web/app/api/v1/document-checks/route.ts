import { NextRequest, NextResponse } from "next/server";
import { guardV1 } from "@/lib/v1-guard";
import { createServiceClient } from "@askarthur/supabase/server";
import { inspectDocument } from "@askarthur/scam-engine/document-check";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import {
  DOCUMENT_CHECK_DISCLAIMER,
  DOCUMENT_CHECK_MAX_UPLOAD_BYTES,
  type WebDocumentCheckResponse,
} from "@askarthur/types";
import { documentAllowanceForOrg } from "@/lib/document-allowance";
import { recordDocumentCheck } from "@/lib/document-check-records";
import { consumeMonthlyQuota, secondsToMonthEnd } from "@/lib/v1-quota";
import { parsePeriodDays } from "@/lib/v1-params";
import { logCost } from "@/lib/cost-telemetry";

// B2B Document Check (Stage 2; rental-vertical pilot surface).
// - POST (endpoint slug `document-checks.submit`): per-document check — the
//   same inspectDocument seam as the consumer route, plus an org-attributed
//   evidence record when flagged. Requires an ORG-LINKED key: the monthly
//   allowance (documentAllowanceForOrg: doc-plan entitlement, tier fallback) is billed per
//   organisation, shared across the org's keys. The meter is consumed ONLY
//   after the upload validates — malformed requests never burn paid units.
// - GET (endpoint slug `document-checks`): the calling organisation's own
//   flagged records — NEVER a global feed. Distinct slugs let a read-only
//   dashboard key be scoped to the feed without granting submission.
// Both dark behind FF_DOCUMENT_CHECK_V1_API until the first pilot key is
// provisioned.

const MAX_UPLOAD_BYTES = DOCUMENT_CHECK_MAX_UPLOAD_BYTES;

const SELECT_COLUMNS =
  "check_ref, checked_at, doc_sha256, jurisdiction, source, structural_summary, findings, abn_summary";

export async function GET(req: NextRequest) {
  if (!featureFlags.documentCheckV1Api) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 503 });
  }
  const guard = await guardV1(req, "document-checks");
  if (!guard.ok) return guard.error;
  if (!guard.auth.orgId) {
    return NextResponse.json(
      { error: "org_key_required", message: "This endpoint requires an organisation-linked API key." },
      { status: 403 },
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const days = parsePeriodDays(req.nextUrl.searchParams.get("period"));
  const since = new Date();
  since.setDate(since.getDate() - days);

  try {
    const { data: checks, error } = await supabase
      .from("document_check_records")
      .select(SELECT_COLUMNS)
      .eq("org_id", guard.auth.orgId)
      .gte("checked_at", since.toISOString())
      .order("checked_at", { ascending: false })
      .limit(100);
    if (error) {
      logger.error("document-checks feed query error", { error: String(error) });
      return NextResponse.json({ error: "query_failed" }, { status: 500 });
    }
    return NextResponse.json({
      meta: { period_days: days, total: checks?.length ?? 0, generated_at: new Date().toISOString() },
      checks: checks ?? [],
    });
  } catch (err) {
    logger.error("document-checks feed error", { error: String(err) });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!featureFlags.documentCheckV1Api) {
      return NextResponse.json({ error: "feature_disabled" }, { status: 503 });
    }
    const contentLength = parseInt(req.headers.get("content-length") || "0");
    if (contentLength > MAX_UPLOAD_BYTES + 50_000) {
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    }
    const guard = await guardV1(req, "document-checks.submit");
    if (!guard.ok) return guard.error;
    if (!guard.auth.orgId) {
      // The allowance is per-organisation; an org-less key has no meter to
      // bill against (and every pilot key is org-provisioned).
      return NextResponse.json(
        { error: "org_key_required", message: "This endpoint requires an organisation-linked API key." },
        { status: 403 },
      );
    }

    // Allowance precedence: org doc-plan entitlement (Stripe or manual
    // pilot) over the interim tier fallback — resolved in ONE place
    // (lib/document-allowance.ts) shared with /api/v1/usage.
    const tier = guard.auth.tier ?? "free";
    const allowance = await documentAllowanceForOrg(guard.auth.orgId, tier);
    const monthlyLimit = allowance.monthlyLimit;
    if (monthlyLimit === 0) {
      // Degraded-zero means "could not read the org's entitlement", not
      // "no plan" — a Supabase blip must never 402 a paying pilot with a
      // permanent-looking error (ADR-0009's unverified ≠ unregistered,
      // applied to billing).
      if (allowance.degraded) {
        return NextResponse.json(
          { error: "service_unavailable", message: "Plan lookup briefly unavailable. Try again shortly." },
          { status: 503, headers: { "Retry-After": "60" } },
        );
      }
      return NextResponse.json(
        {
          error: "plan_required",
          message: "Document checks are not included in your plan. Contact us to enable them.",
        },
        { status: 402 },
      );
    }

    // ---- validate the upload BEFORE consuming any allowance --------------
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
        { error: "unsupported_file", message: "Only PDF documents are supported." },
        { status: 422 },
      );
    }

    // ---- meter (org-scoped, fail-closed in prod, non-refundable) ---------
    const quota = await consumeMonthlyQuota("document_check", guard.auth.orgId, monthlyLimit);
    if (!quota.allowed && quota.reason === "store_unavailable") {
      return NextResponse.json(
        { error: "service_unavailable", message: "Metering briefly unavailable. Try again shortly." },
        { status: 503, headers: { "Retry-After": "60" } },
      );
    }
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: "monthly_limit_reached",
          message: `Monthly document-check allowance (${monthlyLimit}) reached. Resets on the 1st (UTC).`,
        },
        { status: 429, headers: { "Retry-After": String(secondsToMonthEnd()) } },
      );
    }

    const inspection = await inspectDocument(buffer, { jurisdiction: "au" });

    // Volume telemetry for the paid surface (still $0 — no vendor spend).
    logCost({
      feature: "document_check",
      provider: "internal",
      operation: "structural-scan",
      units: 1,
      unitCostUsd: 0,
      metadata: {
        surface: "document_check_api",
        tier,
        findings: inspection.findings.length,
        is_pdf: inspection.structural.isPdf,
      },
      requestId: null,
    });

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

    const response: WebDocumentCheckResponse & { monthlyRemaining: number } = {
      checked: true,
      mode: "upload",
      ...inspection,
      checkRef: await recordDocumentCheck(inspection, {
        source: "api",
        orgId: guard.auth.orgId,
        apiKeyHash: guard.auth.keyHash ?? null,
      }),
      disclaimer: DOCUMENT_CHECK_DISCLAIMER,
      monthlyRemaining: quota.remaining,
    };
    return NextResponse.json(response);
  } catch (err) {
    logger.error("v1 document-check error", { error: String(err) });
    return NextResponse.json(
      { error: "document_check_failed", message: "Something went wrong checking this document." },
      { status: 500 },
    );
  }
}
