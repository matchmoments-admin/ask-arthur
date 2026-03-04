import { NextRequest, NextResponse } from "next/server";
import { validateExtensionRequest } from "../../_lib/auth";

// In production, this would be sourced from a database table synced from
// malicious_extension_sentry feeds. For now, return an empty delta to
// indicate no updates beyond the bundled database.
const THREAT_DB_UPDATED_AT = "2026-03-04";

export async function GET(req: NextRequest) {
  // Authenticate
  const auth = await validateExtensionRequest(req);
  if (!auth.valid) {
    return NextResponse.json(
      { error: auth.error },
      {
        status: auth.status,
        headers: auth.retryAfter
          ? { "Retry-After": auth.retryAfter }
          : undefined,
      }
    );
  }

  const since = req.nextUrl.searchParams.get("since");

  // Validate date format if provided
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return NextResponse.json(
      { error: "Invalid since parameter (expected YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const cacheHeaders = {
    "Cache-Control": "private, max-age=3600",
    "X-RateLimit-Remaining": String(auth.remaining),
  };

  // If client already has the latest version, return empty delta
  if (since && since >= THREAT_DB_UPDATED_AT) {
    return NextResponse.json(
      { ids: {}, updatedAt: THREAT_DB_UPDATED_AT },
      { headers: cacheHeaders }
    );
  }

  // Return full threat DB delta
  // In production, query database for entries newer than `since`
  return NextResponse.json(
    { ids: {}, updatedAt: THREAT_DB_UPDATED_AT },
    { headers: cacheHeaders }
  );
}
