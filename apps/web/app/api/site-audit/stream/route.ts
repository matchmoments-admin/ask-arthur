import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkFormRateLimit } from "@askarthur/utils/rate-limit";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { runSiteAuditStreaming } from "@askarthur/site-audit/scanner";
import type { ScanEvent } from "@askarthur/site-audit/scanner";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

const RequestSchema = z.object({
  url: z.string().url().max(2048),
});

export async function POST(req: NextRequest) {
  // 0. Feature flag guard
  if (!featureFlags.siteAudit) {
    return NextResponse.json(
      { error: "feature_disabled", message: "Website Health Check is not yet available." },
      { status: 404 }
    );
  }

  // 1. Rate limit (5/hour per IP)
  const ip =
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";

  const rateCheck = await checkFormRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: rateCheck.message,
        resetAt: rateCheck.resetAt?.toISOString(),
      },
      { status: 429 }
    );
  }

  // 2. Validate input
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "validation_error", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", message: parsed.error.issues[0]?.message },
      { status: 400 }
    );
  }

  // 3. Normalize URL
  let url = parsed.data.url.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }

  // 4. Stream results via SSE
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      }

      const emit = (event: ScanEvent) => {
        try {
          send(event.type, event.data);

          // On complete, store to DB and close
          if (event.type === "complete") {
            const result = event.data;
            // Store in DB non-blocking
            storeAuditResult(result, url).then((shareUrl) => {
              if (shareUrl) {
                send("share", { shareUrl });
              }
              controller.close();
            }).catch(() => {
              controller.close();
            });
          }
        } catch {
          // Stream may be closed
        }
      };

      try {
        await runSiteAuditStreaming({ url }, emit);
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : "Scan failed",
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-RateLimit-Remaining": String(rateCheck.remaining),
    },
  });
}

async function storeAuditResult(
  result: import("@askarthur/site-audit/types").SiteAuditResult,
  _originalUrl: string
): Promise<string | undefined> {
  const supabase = createServiceClient();
  if (!supabase) return undefined;

  try {
    const { data, error } = await supabase.rpc("upsert_site_and_store_audit", {
      p_domain: result.domain,
      p_normalized_url: result.url,
      p_overall_score: result.overallScore,
      p_grade: result.grade,
      p_test_results: result.checks,
      p_category_scores: result.categories,
      p_recommendations: result.recommendations,
      p_duration_ms: result.durationMs,
      p_partial: result.partial,
      p_fetch_error: result.fetchError,
      p_raw_headers: result.rawHeaders,
    });

    if (error) {
      logger.error("Failed to store site audit (stream)", {
        error: error.message,
        url: result.url,
      });
      return undefined;
    }

    if (data && data.length > 0) {
      const token = data[0].share_token;
      if (token) return `https://askarthur.au/scan/${token}`;
    }
  } catch (dbErr) {
    logger.error("Site audit DB write threw (stream)", {
      error: dbErr instanceof Error ? dbErr.message : String(dbErr),
      url: result.url,
    });
  }

  return undefined;
}
