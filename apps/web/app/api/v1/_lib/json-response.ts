import { NextResponse } from "next/server";

/**
 * Wrap a v1 success response with a `lastUpdated` ISO-8601 timestamp so
 * bank consumers can see exactly when the data backing this snapshot was
 * generated. When the response is served from CDN cache, the cached body
 * carries the cached timestamp — that's the desired semantics: it tells
 * the caller "this is how stale the data layer is", not the wall clock.
 *
 * Use only on successful (data-bearing) 200 responses; error responses
 * stay on `NextResponse.json` directly because a freshness timestamp on
 * a 401/404/500 is misleading.
 */
export function jsonV1<T extends Record<string, unknown>>(
  body: T,
  init?: ResponseInit
): NextResponse {
  return NextResponse.json(
    { ...body, lastUpdated: new Date().toISOString() },
    init
  );
}
