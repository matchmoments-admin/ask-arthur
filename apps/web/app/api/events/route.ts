import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logEvent } from "@/lib/analytics-events";
import { featureFlags } from "@askarthur/utils/feature-flags";

// Client-side analytics ingestion. Deliberately restricted to events that can
// ONLY be observed in the browser (scan_started, feed_view, pageview). The
// revenue-critical / server-authoritative events — scan_completed,
// contact_submit, scam_report_submitted, extension_install — are emitted
// server-side from their route handlers and are NOT accepted here, so a user
// can't inflate them from the console. Attribution + the visitor identity come
// from the httpOnly aa_attribution cookie inside logEvent(), never the body.

// extension_install is accepted here as an INTENT signal (the "Add to Chrome"
// CTA click) — the actual Web Store install is invisible to us, and the
// extension's /api/extension/register call carries no first-party cookie, so
// the CTA click is the last attributable first-party touch.
const CLIENT_EVENT_TYPES = [
  "scan_started",
  "feed_view",
  "pageview",
  "extension_install",
  // Next Steps funnel — a report-destination tap. Client-only-observable and
  // metadata-only; further gated by FF_ROUTE_CLICK_TELEMETRY below.
  "reporting_route_click",
] as const;

const EventSchema = z.object({
  eventType: z.enum(CLIENT_EVENT_TYPES),
  // Metadata only — bounded scalar map. Anything richer is rejected so raw
  // content can never be smuggled into event_props.
  eventProps: z
    .record(z.string().max(64), z.union([z.string().max(120), z.number(), z.boolean()]))
    .refine((o) => Object.keys(o).length <= 12, "too many props")
    .optional(),
  path: z.string().max(512).optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = EventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }

  // Route-click telemetry is off by default — accept-and-drop when the flag is
  // off so the client never errors and no partial data lands mid-canary.
  if (
    parsed.data.eventType === "reporting_route_click" &&
    !featureFlags.routeClickTelemetry
  ) {
    return new NextResponse(null, { status: 204 });
  }

  // Fire-and-forget: logEvent no-ops without an attribution cookie and never
  // throws. requestId comes from the middleware-propagated header.
  await logEvent({
    eventType: parsed.data.eventType,
    eventProps: parsed.data.eventProps,
    path: parsed.data.path,
    requestId: req.headers.get("x-request-id"),
  });

  return new NextResponse(null, { status: 204 });
}
