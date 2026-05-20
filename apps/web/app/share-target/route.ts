import { NextRequest, NextResponse } from "next/server";
import type { ReferrerSource } from "@askarthur/types";

/**
 * Web Share Target handler for Android PWA.
 * Receives shared text/URL from other apps and redirects to the homepage
 * with query params so ScamChecker can pre-fill the textarea.
 *
 * Images require a service worker + Cache API to transfer (deferred to Phase 2).
 *
 * Stage 0.5 of Shop Guard also sniffs the inbound `Referer` header and
 * `User-Agent` substring for in-app-browser hints (Instagram / TikTok /
 * Facebook / WhatsApp) and forwards the source onto the redirect as
 * `shared_inapp`. ScamChecker.tsx reads it and passes it to /api/analyze
 * as the `referrerSource` body field; shop-signal stamps it onto the
 * response payload so the Stage-0 measurement window can quantify what
 * share of commerce-flagged volume arrives from a social share-sheet.
 */
/**
 * Cap raw share-target input length BEFORE it lands in a 303 redirect URL.
 * Downstream `/api/analyze` Zod schema enforces a 10K-char cap; without an
 * earlier cap here, a giant share-target POST occupies the redirect chain
 * (browser → reflected 303 with multi-KB query string → next request →
 * Zod rejection). 5000 chars is comfortably above any legitimate paste
 * (a long phishing email body is ~2-3K), below the practical URL-length
 * concern (~8K on most stacks), and well under the downstream 10K Zod cap.
 */
const SHARE_TARGET_MAX_CHARS = 5000;

export async function POST(request: NextRequest) {
  const formData = await request.formData();

  const text = formData.get("text")?.toString() ?? "";
  const url = formData.get("url")?.toString() ?? "";
  const title = formData.get("title")?.toString() ?? "";

  // Combine non-empty parts into a single shared string, then cap length
  // before constructing the redirect URL (soft-DoS guard — see comment above).
  const parts = [title, text, url].filter(Boolean);
  const sharedText = parts.join("\n").slice(0, SHARE_TARGET_MAX_CHARS);

  const referrerSource = detectInappReferrer(
    request.headers.get("user-agent"),
    request.headers.get("referer"),
  );

  const redirectUrl = new URL("/", request.url);
  if (sharedText) {
    redirectUrl.searchParams.set("shared_text", sharedText);
  }
  if (referrerSource) {
    redirectUrl.searchParams.set("shared_inapp", referrerSource);
  }

  return NextResponse.redirect(redirectUrl, { status: 303 });
}

/**
 * Identify the in-app browser the share came from. User-Agent substrings
 * are the load-bearing signal — social apps inject distinctive tokens
 * (`Instagram`, `musical_ly`/`TikTok`, `FBAN`/`FBAV`, `WhatsApp`) that
 * survive UA-spoofing better than Referer (which Android Chrome strips
 * to origin-only for cross-origin POSTs). Referer is the tiebreaker for
 * the WhatsApp case, where iOS sometimes routes through Safari and the
 * UA loses its WhatsApp tag — `referer === "https://api.whatsapp.com/"`
 * still gives us the signal.
 *
 * Returns null when no recognised in-app browser is detected; callers
 * treat that as "direct share" / "external browser" and omit the
 * `shared_inapp` param.
 */
export function detectInappReferrer(
  userAgent: string | null,
  referer: string | null,
): ReferrerSource | null {
  if (userAgent) {
    if (/(\bInstagram\b)/i.test(userAgent)) return "instagram-inapp";
    if (/(musical_ly|TikTok)/i.test(userAgent)) return "tiktok-inapp";
    if (/(FBAN|FBAV)/i.test(userAgent)) return "facebook-inapp";
    if (/WhatsApp/i.test(userAgent)) return "whatsapp-inapp";
  }
  if (referer) {
    if (/whatsapp\.com/i.test(referer)) return "whatsapp-inapp";
    if (/instagram\.com/i.test(referer)) return "instagram-inapp";
    if (/tiktok\.com/i.test(referer)) return "tiktok-inapp";
    if (/facebook\.com/i.test(referer)) return "facebook-inapp";
  }
  return null;
}
