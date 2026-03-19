import { NextRequest, NextResponse } from "next/server";

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

  try {
    const upstream = await fetch(imageUrl, {
      headers: {
        "User-Agent": "AskArthur-ImageProxy/1.0",
      },
      signal: AbortSignal.timeout(10000),
      redirect: "manual",
    });

    // Handle redirects — re-validate the target domain
    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get("location");
      if (!location) {
        return NextResponse.json({ error: "Redirect with no location" }, { status: 502 });
      }
      try {
        const redirectParsed = new URL(location, imageUrl);
        if (!ALLOWED_DOMAINS.has(redirectParsed.hostname)) {
          return NextResponse.json({ error: "Redirect to disallowed domain" }, { status: 403 });
        }
        // Follow the redirect to the allowed domain
        const redirected = await fetch(redirectParsed.toString(), {
          headers: { "User-Agent": "AskArthur-ImageProxy/1.0" },
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        });
        if (!redirected.ok) {
          return NextResponse.json({ error: "Upstream fetch failed" }, { status: redirected.status });
        }
        const rContentType = redirected.headers.get("content-type") || "image/jpeg";
        if (!rContentType.startsWith("image/")) {
          return NextResponse.json({ error: "Not an image" }, { status: 400 });
        }
        const rBody = redirected.body;
        if (!rBody) {
          return NextResponse.json({ error: "Empty response" }, { status: 502 });
        }
        return new NextResponse(rBody, {
          headers: {
            "Content-Type": rContentType,
            "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=1800",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch {
        return NextResponse.json({ error: "Invalid redirect URL" }, { status: 502 });
      }
    }

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "Upstream fetch failed" },
        { status: upstream.status }
      );
    }

    const contentLength = upstream.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_SIZE) {
      return NextResponse.json({ error: "Image too large" }, { status: 413 });
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";

    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "Not an image" }, { status: 400 });
    }

    const body = upstream.body;
    if (!body) {
      return NextResponse.json({ error: "Empty response" }, { status: 502 });
    }

    // Enforce size limit on streamed responses (chunked transfer without content-length)
    let bytesRead = 0;
    const sizeLimit = new TransformStream({
      transform(chunk, controller) {
        bytesRead += chunk.byteLength;
        if (bytesRead > MAX_SIZE) {
          controller.error(new Error("Image too large"));
          return;
        }
        controller.enqueue(chunk);
      },
    });
    const limitedBody = body.pipeThrough(sizeLimit);

    return new NextResponse(limitedBody, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=1800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Proxy fetch failed" }, { status: 502 });
  }
}
