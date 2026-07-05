import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { featureFlags } from "@askarthur/utils/feature-flags";
import {
  ATTRIBUTION_COOKIE,
  parseAttribution,
  writeEvent,
  type Attribution,
} from "@/lib/analytics-events";
import { SHORT_LINKS } from "@/lib/short-links";

// In-house branded short-link redirect. Logs the click server-side (survives
// LinkedIn referrer-stripping) then 302s to the destination with UTMs intact.
// This route — not middleware — is the sole first-touch authority for /go/*
// because the short link itself is clean; it bakes the slug's UTMs into both
// the destination URL and the aa_attribution cookie (first-touch guarded).

const ATTRIBUTION_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const link = SHORT_LINKS[slug];

  // Unknown slug — send to home rather than 404 a shared social link.
  const origin = req.nextUrl.origin;
  if (!link) {
    return NextResponse.redirect(new URL("/", origin), 302);
  }

  // Build the destination with UTMs stamped on.
  const target = new URL(link.dest, origin);
  target.searchParams.set("utm_source", link.source);
  target.searchParams.set("utm_medium", link.medium);
  target.searchParams.set("utm_campaign", link.campaign);
  if (link.content) target.searchParams.set("utm_content", link.content);

  const res = NextResponse.redirect(target, 302);

  if (featureFlags.analyticsAttribution) {
    // Determine first touch from the cookie the BROWSER sent (a prior session).
    // The middleware-set cookie from this same request isn't readable here.
    let attr: Attribution | null = null;
    try {
      const store = await cookies();
      attr = parseAttribution(store.get(ATTRIBUTION_COOKIE)?.value);
    } catch {
      attr = null;
    }

    if (!attr) {
      // True first touch — mint identity + attribute to THIS campaign, and set
      // the cookie so downstream conversions inherit it.
      attr = {
        anonymous_id: crypto.randomUUID(),
        utm_source: link.source,
        utm_medium: link.medium,
        utm_campaign: link.campaign,
        utm_content: link.content,
        referrer: req.headers.get("referer") ?? "",
        landing_path: `/go/${slug}`,
      };
      res.cookies.set(ATTRIBUTION_COOKIE, JSON.stringify(attr), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: ATTRIBUTION_MAX_AGE,
      });
    }

    // Log the click against the (first-touch) attribution. Returning visitors
    // keep their original attribution; the slug they clicked is in event_props.
    writeEvent(attr, {
      eventType: "link_click",
      eventProps: { slug, campaign: link.campaign, content: link.content ?? "" },
      path: `/go/${slug}`,
    });
  }

  return res;
}
