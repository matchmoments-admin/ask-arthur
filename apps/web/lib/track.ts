"use client";

// Client-side first-party event beacon. Posts to /api/events, which validates
// against the client-safe event set and writes via logEvent() (attribution +
// identity come from the httpOnly aa_attribution cookie, never the body).
//
// Fire-and-forget: never awaited, never throws, no-ops on the server. Runs
// alongside the existing Plausible custom events — it does not replace them.

type ClientEventType = "scan_started" | "feed_view" | "pageview" | "extension_install";

export function track(
  eventType: ClientEventType,
  eventProps?: Record<string, string | number | boolean>,
): void {
  if (typeof window === "undefined") return;
  try {
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType,
        eventProps,
        path: window.location.pathname,
      }),
      keepalive: true, // survive a navigation triggered right after the call
    }).catch(() => {});
  } catch {
    // Never let telemetry break the UI.
  }
}
