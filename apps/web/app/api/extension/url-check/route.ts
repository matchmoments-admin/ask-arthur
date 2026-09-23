import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeURL } from "@askarthur/scam-engine/url-normalize";
import { checkAnalyzeUrlReputation } from "@askarthur/scam-engine/first-party-url-reputation";
import { resolveRedirectChain } from "@askarthur/scam-engine/redirect-resolver";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { validateExtensionRequest } from "../_lib/auth";
import type { ExtensionURLCheckResponse } from "@askarthur/types";

const URLCheckSchema = z.object({
  url: z.string().url().max(2048),
});

export async function POST(req: NextRequest) {
  try {
    // 1. Auth + rate limit
    const auth = await validateExtensionRequest(req);
    if (!auth.valid) {
      return NextResponse.json(
        { error: auth.error },
        {
          status: auth.status,
          ...(auth.retryAfter && {
            headers: { "Retry-After": auth.retryAfter },
          }),
        }
      );
    }

    // 2. Validate input
    const body = await req.json();
    const parsed = URLCheckSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }

    // 3. Normalize URL
    const norm = normalizeURL(parsed.data.url);
    if (!norm) {
      return NextResponse.json(
        { error: "validation_error", message: "Could not normalize URL" },
        { status: 400 }
      );
    }

    // 4. Resolve redirects when feature flag is on
    let redirectInfo: { finalUrl: string; hopCount: number; isShortened: boolean } | undefined;
    if (featureFlags.redirectResolve) {
      const chain = await resolveRedirectChain(parsed.data.url);
      if (chain.finalUrl !== chain.originalUrl) {
        redirectInfo = {
          finalUrl: chain.finalUrl,
          hopCount: chain.hopCount,
          isShortened: chain.isShortened,
        };
      }
    }

    // 5. URL reputation through the ONE analyze seam: GSB + VirusTotal and,
    //    when FF_ANALYZE_FIRST_PARTY_URLS is on, First-party URL Reputation —
    //    in parallel, merged per URL. This route used to query `scam_urls`
    //    itself (is_active only, exact URL), which trusted report-driven rows
    //    (upsert_scam_url scores four user reports 'high' — abuse-reachable)
    //    and missed `/login` on a clone's host-root row. The module owns the
    //    lookup keys AND the verified-source predicate; never re-query here.
    const urlsToCheck = [parsed.data.url];
    if (redirectInfo && redirectInfo.finalUrl !== parsed.data.url) {
      urlsToCheck.push(redirectInfo.finalUrl);
    }
    const results = await checkAnalyzeUrlReputation(urlsToCheck, {
      requestId: auth.requestId ?? undefined,
      source: "api/extension/url-check",
    });

    // 6. The first malicious result wins; otherwise the first (clean) result
    //    is passed through so the popup can show what was checked.
    const hit = results.find((r) => r.isMalicious);
    const shown = hit ?? results[0];
    const found = hit !== undefined;
    const safeBrowsing = shown
      ? { isMalicious: shown.isMalicious, sources: shown.sources }
      : undefined;

    // 7. Return response. `reportCount` is no longer set: report counts are
    //    not a reputation signal here (see step 5).
    const response: ExtensionURLCheckResponse = {
      found,
      ...(found && { threatLevel: "HIGH" as const }),
      domain: norm.domain,
      ...(safeBrowsing && { safeBrowsing }),
      ...(redirectInfo && { redirect: redirectInfo }),
    };

    return NextResponse.json(response, {
      headers: { "X-RateLimit-Remaining": String(auth.remaining) },
    });
  } catch (err) {
    logger.error("Extension URL check error", { error: String(err) });
    return NextResponse.json(
      { error: "check_failed", message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
