import { NextRequest, NextResponse } from "next/server";

/**
 * Web Share Target handler for Android PWA.
 * Receives shared text/URL from other apps and redirects to the homepage
 * with query params so ScamChecker can pre-fill the textarea.
 *
 * Images require a service worker + Cache API to transfer (deferred to Phase 2).
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData();

  const text = formData.get("text")?.toString() ?? "";
  const url = formData.get("url")?.toString() ?? "";
  const title = formData.get("title")?.toString() ?? "";

  // Combine non-empty parts into a single shared string
  const parts = [title, text, url].filter(Boolean);
  const sharedText = parts.join("\n");

  const redirectUrl = new URL("/", request.url);
  if (sharedText) {
    redirectUrl.searchParams.set("shared_text", sharedText);
  }

  return NextResponse.redirect(redirectUrl, { status: 303 });
}
