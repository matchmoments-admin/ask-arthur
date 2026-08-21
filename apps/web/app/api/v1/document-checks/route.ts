import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { guardV1 } from "@/lib/v1-guard";
import { createServiceClient } from "@askarthur/supabase/server";
import { inspectDocument } from "@askarthur/scam-engine/document-check";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import {
  DOCUMENT_CHECK_DISCLAIMER,
  TIER_LIMITS,
  type WebDocumentCheckResponse,
} from "@askarthur/types";
import { recordDocumentCheck } from "@/lib/document-check-records";
import { logCost } from "@/lib/cost-telemetry";

// B2B Document Check (Stage 2; rental-vertical pilot surface).
// - POST: per-document check — the same inspectDocument seam as the consumer
//   route, plus an org-attributed evidence record when flagged. Metered per
//   calendar month from TIER_LIMITS[tier].documentChecksPerMonth (0 = tier
//   has no document allowance → 402). The counter fails CLOSED in prod
//   (quota is a rate-limit-class control — CLAUDE.md Never list).
// - GET: the calling organisation's own flagged records — org-scoped via
//   the key's orgId, NEVER a global feed (a pilot property manager sees
//   their checks, nobody else's).
// Both dark behind FF_DOCUMENT_CHECK_V1_API until the first pilot key is
// provisioned (per-key allowed_endpoints scoping applies on top).

const MAX_UPLOAD_BYTES = 10_000_000;

const SELECT_COLUMNS =
  "check_ref, checked_at, doc_sha256, jurisdiction, source, structural_summary, findings, abn_summary";

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL) return null;
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return _redis;
}

/** INCR the caller's calendar-month counter. Returns the count after
 *  increment, or null when the store is unavailable. */
async function bumpMonthlyCount(scope: string): Promise<number | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    const key = `askarthur:doccheck:month:${scope}:${month}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 60 * 60 * 24 * 40);
    return count;
  } catch (err) {
    logger.error("document-checks: monthly counter unavailable", { error: String(err) });
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!featureFlags.documentCheckV1Api) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 503 });
  }
  const guard = await guardV1(req);
  if (!guard.ok) return guard.error;
  if (!guard.auth.orgId) {
    return NextResponse.json(
      { error: "This endpoint requires an organisation-linked API key" },
      { status: 403 },
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const days = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("period")?.replace(/d$/, "") ?? "30") || 30, 1),
    90,
  );
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
      return NextResponse.json({ error: "Failed to fetch document checks" }, { status: 500 });
    }
    return NextResponse.json({
      meta: { period_days: days, total: checks?.length ?? 0, generated_at: new Date().toISOString() },
      checks: checks ?? [],
    });
  } catch (err) {
    logger.error("document-checks feed error", { error: String(err) });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
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
    const guard = await guardV1(req);
    if (!guard.ok) return guard.error;

    const tier = (guard.auth.tier ?? "free") as keyof typeof TIER_LIMITS;
    const monthlyLimit = TIER_LIMITS[tier]?.documentChecksPerMonth ?? 0;
    if (monthlyLimit === 0) {
      return NextResponse.json(
        {
          error: "plan_required",
          message: "Document checks are not included in your plan. Contact us to enable them.",
        },
        { status: 402 },
      );
    }

    // Meter BEFORE the work; fail closed when the counter is unavailable.
    const scope = guard.auth.orgId ?? guard.auth.keyHash ?? "unknown";
    const count = await bumpMonthlyCount(scope);
    if (count === null) {
      return NextResponse.json(
        { error: "service_unavailable", message: "Metering briefly unavailable. Try again shortly." },
        { status: 503, headers: { "Retry-After": "60" } },
      );
    }
    if (count > monthlyLimit) {
      return NextResponse.json(
        {
          error: "monthly_limit_reached",
          message: `Monthly document-check allowance (${monthlyLimit}) reached.`,
        },
        { status: 429 },
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
        { error: "unsupported_file", message: "Only PDF documents are supported." },
        { status: 422 },
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
      checkRef: recordDocumentCheck(inspection, {
        source: "api",
        orgId: guard.auth.orgId ?? null,
        apiKeyHash: guard.auth.keyHash ?? null,
      }),
      disclaimer: DOCUMENT_CHECK_DISCLAIMER,
      monthlyRemaining: Math.max(0, monthlyLimit - count),
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
