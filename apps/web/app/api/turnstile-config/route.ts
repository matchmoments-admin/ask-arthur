import { NextResponse } from "next/server";

// Exposes the PUBLIC Cloudflare Turnstile site key so the static overview deck
// (apps/web/public/overview.html — not part of the Next bundle, so it can't
// read NEXT_PUBLIC_* at build time) can render the Turnstile widget. The site
// key is public by design; the secret stays server-side in the verify step.
export const runtime = "nodejs";

export function GET() {
  const siteKey = process.env["NEXT_PUBLIC_TURNSTILE_SITE_KEY"] ?? "";
  return NextResponse.json(
    { siteKey },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
