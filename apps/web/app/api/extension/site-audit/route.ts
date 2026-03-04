import { NextRequest, NextResponse } from "next/server";
import { validateExtensionRequest } from "../_lib/auth";
import { logger } from "@askarthur/utils/logger";

export async function POST(req: NextRequest) {
  const auth = await validateExtensionRequest(req);
  if (!auth.valid) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status }
    );
  }

  let body: { url: string; pageData?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.url) {
    return NextResponse.json({ error: "URL required" }, { status: 400 });
  }

  try {
    // Combine client-side page data with server-side checks
    const url = new URL(body.url);
    const domain = url.hostname;

    // Basic server-side security analysis
    const audit = {
      domain,
      url: body.url,
      clientFindings: body.pageData ?? {},
      serverChecks: {
        isHttps: url.protocol === "https:",
        timestamp: new Date().toISOString(),
      },
    };

    return NextResponse.json(audit, {
      headers: {
        "X-RateLimit-Remaining": String(auth.remaining),
      },
    });
  } catch (err) {
    logger.error("Site audit error", { error: err });
    return NextResponse.json(
      { error: "Audit failed" },
      { status: 500 }
    );
  }
}
