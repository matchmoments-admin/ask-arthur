import { NextRequest, NextResponse } from "next/server";
import { safeFetch } from "@askarthur/scam-engine/safe-fetch";

const ALLOWED_DOMAINS = new Set([
  "preview.redd.it",
  "i.redd.it",
  "i.imgur.com",
]);

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export async function GET(req: NextRequest) {
  const imageUrl = req.nextUrl.searchParams.get("url");

  if (!imageUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Only HTTPS URLs allowed" }, { status: 400 });
  }

  if (!ALLOWED_DOMAINS.has(parsed.hostname)) {
    return NextResponse.json({ error: "Domain not allowed" }, { status: 403 });
  }

  // safeFetch owns the rest: the host allowlist on the initial URL AND on the
  // one redirect we follow, the SSRF-safe dispatcher, the 5 MB streamed cap
  // (a chunked multi-GB body can no longer bypass it) and the timeout.
  const r = await safeFetch(imageUrl, {
    headers: { "User-Agent": "AskArthur-ImageProxy/1.0" },
    timeoutMs: 10_000,
    maxBytes: MAX_SIZE,
    redirect: "follow-checked",
    maxRedirects: 1,
    allowHosts: ALLOWED_DOMAINS,
    as: "bytes",
  });
  if (!r.ok) {
    if (r.reason === "too_large") {
      return NextResponse.json({ error: "Image too large" }, { status: 413 });
    }
    if (r.reason === "blocked") {
      return NextResponse.json({ error: "Redirect to disallowed domain" }, { status: 403 });
    }
    if (r.reason === "http" && r.status) {
      return NextResponse.json({ error: "Upstream fetch failed" }, { status: r.status });
    }
    if (r.reason === "redirects" && r.detail === "no-location") {
      return NextResponse.json({ error: "Redirect with no location" }, { status: 502 });
    }
    return NextResponse.json({ error: "Proxy fetch failed" }, { status: 502 });
  }

  const contentType = r.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) {
    return NextResponse.json({ error: "Not an image" }, { status: 400 });
  }
  return new NextResponse(r.body as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=1800",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
