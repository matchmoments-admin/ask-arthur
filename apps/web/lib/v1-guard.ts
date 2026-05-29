import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, type ApiKeyValidation } from "@/lib/apiAuth";

export type V1GuardResult =
  | { ok: true; auth: ApiKeyValidation }
  | { ok: false; error: NextResponse };

/**
 * Standard B2B `/api/v1/*` auth guard. Wraps `validateApiKey()` and returns the
 * correct error Response for every failure mode, so each route checks all four
 * flags consistently instead of an ad-hoc subset.
 *
 * Usage:
 *   const guard = await guardV1(req);
 *   if (!guard.ok) return guard.error;
 *   // guard.auth is a validated ApiKeyValidation here
 *
 * The endpoint slug defaults to one derived from the request path
 * (`/api/v1/scams/search` -> `scams.search`). Passing it (not omitting it) is
 * what makes `validateApiKey` (a) enforce per-key `allowed_endpoints` scoping
 * and (b) write a per-endpoint `log_api_usage` row — both are no-ops when the
 * arg is absent.
 *
 * Born from the /ultracode audit (2026-05-30): only the two `deepfakes` routes
 * checked `endpointBlocked` + `minuteRateLimited`; every other v1 route checked
 * at most `{ valid, rateLimited }` and passed no endpoint, so per-key endpoint
 * scoping and the per-minute limit were dead, and most routes logged no usage.
 */
export async function guardV1(
  req: NextRequest,
  endpoint?: string
): Promise<V1GuardResult> {
  const slug = endpoint ?? deriveEndpoint(req);
  const auth = await validateApiKey(req, slug);

  if (!auth.valid) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: "Invalid or missing API key" },
        { status: 401 }
      ),
    };
  }

  if (auth.endpointBlocked) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: "Your API key does not have access to this endpoint" },
        { status: 403 }
      ),
    };
  }

  if (auth.rateLimited) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: "Daily API limit exceeded. Resets at midnight UTC." },
        { status: 429, headers: { "Retry-After": "3600" } }
      ),
    };
  }

  if (auth.minuteRateLimited) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: "Rate limit exceeded. Please slow down." },
        { status: 429, headers: { "Retry-After": "60" } }
      ),
    };
  }

  return { ok: true, auth };
}

/** `/api/v1/scams/search` -> `scams.search`; `/api/v1/usage` -> `usage`. */
function deriveEndpoint(req: NextRequest): string {
  const path = req.nextUrl.pathname
    .replace(/^\/api\/v1\//, "")
    .replace(/\/+$/, "");
  return path.split("/").filter(Boolean).join(".") || "v1";
}
