import { cookies } from "next/headers";
import { waitUntil } from "@vercel/functions";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

// First-party analytics event writer. Mirrors logCost() (apps/web/lib/
// cost-telemetry.ts): fire-and-forget, service-role, never throws to the
// caller. The difference: it stamps every event with the visitor's WRITE-ONCE
// first-touch attribution, read from the httpOnly `aa_attribution` cookie that
// middleware set on the visitor's first landing.
//
// PRIVACY: eventProps is metadata ONLY — input *type*, verdict *category*,
// timing, campaign. NEVER put scanned content, phone numbers, URLs, or images
// here. The schema (v190) and /api/events Zod validator reaffirm this.

// Keep in sync with the same-named constant in apps/web/middleware.ts. Not
// shared via import on purpose: middleware must not pull next/headers +
// @vercel/functions into its bundle.
export const ATTRIBUTION_COOKIE = "aa_attribution";

// The named events this system understands. Server-side callers pass these
// directly; the /api/events route validates client-sent values against this set.
export const ANALYTICS_EVENT_TYPES = [
  "pageview",
  "scan_started",
  "scan_completed",
  "scan_failed",
  "scam_report_submitted",
  "extension_install",
  "contact_submit",
  "feed_view",
  "digest_click",
  "link_click",
  "clone_citation_shown",
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export interface AnalyticsEvent {
  eventType: AnalyticsEventType;
  /** Metadata only — never raw scanned content. */
  eventProps?: Record<string, unknown>;
  /** Route/path the event fired on (falls back to the cookie's landing_path). */
  path?: string;
  requestId?: string | null;
}

export interface Attribution {
  anonymous_id: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  referrer?: string;
  landing_path?: string;
}

export function parseAttribution(raw: string | undefined): Attribution | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const id = obj.anonymous_id;
    if (typeof id !== "string" || id.length === 0) return null;
    return obj as unknown as Attribution;
  } catch {
    return null;
  }
}

function referringDomain(referrer: string | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget analytics event insert against an EXPLICIT attribution.
 *
 * Used by callers that already know the visitor (e.g. the /go redirect, which
 * mints/reads attribution itself before the cookie is readable in-request).
 * Schedules the Supabase writes via `waitUntil` so they survive the response.
 * No-ops when Supabase is unreachable. Never throws to the caller.
 */
export function writeEvent(attr: Attribution, ev: AnalyticsEvent): void {
  if (!attr?.anonymous_id) return;
  const supabase = createServiceClient();
  if (!supabase) return;

  const p: Promise<void> = (async () => {
    try {
      // Upsert the visitor first (FK target). ignoreDuplicates so the FIRST
      // touch wins — a returning visitor never overwrites their origin.
      const { error: vErr } = await supabase.from("visitors").upsert(
        {
          anonymous_id: attr.anonymous_id,
          first_utm_source: attr.utm_source ?? null,
          first_utm_medium: attr.utm_medium ?? null,
          first_utm_campaign: attr.utm_campaign ?? null,
          first_utm_content: attr.utm_content ?? null,
          first_utm_term: attr.utm_term ?? null,
          first_referrer: attr.referrer || null,
          first_referring_domain: referringDomain(attr.referrer),
          landing_path: attr.landing_path ?? null,
        },
        { onConflict: "anonymous_id", ignoreDuplicates: true },
      );
      if (vErr) {
        logger.warn("logEvent visitor upsert failed", { error: String(vErr) });
        return;
      }

      const { error: eErr } = await supabase.from("analytics_events").insert({
        anonymous_id: attr.anonymous_id,
        event_type: ev.eventType,
        event_props: ev.eventProps ?? {},
        path: ev.path ?? attr.landing_path ?? null,
        utm_source: attr.utm_source ?? null,
        utm_medium: attr.utm_medium ?? null,
        utm_campaign: attr.utm_campaign ?? null,
        utm_content: attr.utm_content ?? null,
        utm_term: attr.utm_term ?? null,
        referrer: attr.referrer || null,
        request_id: ev.requestId ?? null,
      });
      if (eErr) {
        logger.warn("logEvent insert failed", { error: String(eErr) });
      }
    } catch (err) {
      // Analytics must never throw to the caller or surface as an unhandled
      // rejection — the user action it measures has already succeeded.
      logger.warn("logEvent insert threw", { error: String(err) });
    }
  })();

  try {
    waitUntil(p);
  } catch {
    void p;
  }
}

/**
 * Fire-and-forget analytics event insert, attributed via the first-touch
 * cookie. Reads the cookie in-request (cheap, request-scoped) then delegates
 * to writeEvent. No-ops when there's no attribution cookie (visitor predates
 * attribution or the flag is off). Never throws to the caller.
 */
export async function logEvent(ev: AnalyticsEvent): Promise<void> {
  let attr: Attribution | null = null;
  try {
    const store = await cookies();
    attr = parseAttribution(store.get(ATTRIBUTION_COOKIE)?.value);
  } catch {
    // cookies() out of request scope — nothing to attribute against.
    return;
  }
  if (!attr) return;
  writeEvent(attr, ev);
}
