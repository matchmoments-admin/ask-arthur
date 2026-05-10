"use client";

import { useCallback, useEffect, useRef } from "react";
import Script from "next/script";

// Trustpilot's "Mini" template — 5-star strip + score + review count, the
// most recognisable layout and the one that renders a useful grey-stars
// placeholder when a profile has zero reviews. NEXT_PUBLIC_TRUSTPILOT_TEMPLATE_ID
// still overrides if set on Vercel.
const DEFAULT_TEMPLATE_ID = "53aa8807dec7e10d38f59f32";

interface TrustboxProps {
  /** Trustpilot template id (provided by Trustpilot when claiming a profile).
   *  Defaults to the "Mini" template (5 stars + score + review count).
   *  Override per page if needed. */
  templateId?: string;
  /** Trustpilot business unit id. */
  businessUnitId?: string;
  /** Width — Trustpilot accepts pct or px. */
  width?: string;
  /** Height in px — must match the chosen template. Mini = 72px. */
  height?: string;
  /** Theme — light fits the footer, dark for contrast over hero. */
  theme?: "light" | "dark";
}

/**
 * Trustpilot TrustBox widget. Free-tier widget — surfaces whatever rating
 * users have organically left, *including* bad ones. Deliberately passive:
 * we do NOT solicit reviews via in-app CTAs (qualified-moment funneling
 * skews the signal — see /docs/plans/contact-feedback-and-onward-reporting.md
 * §5 reframe).
 *
 * No-ops if env vars are unset, so local dev and unconfigured previews don't
 * render an empty placeholder.
 */
export default function Trustbox({
  templateId,
  businessUnitId,
  width = "100%",
  height = "72px",
  theme = "light",
}: TrustboxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const tpl =
    templateId ??
    process.env.NEXT_PUBLIC_TRUSTPILOT_TEMPLATE_ID ??
    DEFAULT_TEMPLATE_ID;
  const buid =
    businessUnitId ?? process.env.NEXT_PUBLIC_TRUSTPILOT_BUSINESS_UNIT_ID;

  // Trustpilot's bootstrap auto-scans on initial parse, but our useEffect
  // can fire BEFORE the script has loaded — leaving the fallback <a> link
  // visible. Drive both paths off Script's onLoad so we always call
  // loadFromElement after window.Trustpilot exists, and re-attempt on the
  // useEffect for SPA re-mounts where the script is already cached.
  //
  // The hydrate path has historically failed silently in three different
  // ways across deploys (script not loaded, profile unclaimed, BUID typo).
  // The diagnostics here are deliberately verbose — when something breaks
  // we want a single console.error tagged [Trustbox] with enough context to
  // diagnose without a code change. Strip if/when the widget has been stable
  // in prod for 30 days.
  const hydrate = useCallback(
    (trigger: "onLoad" | "useEffect") => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tp = (typeof window !== "undefined" ? (window as any).Trustpilot : null);
      if (!tp) {
        console.warn(
          `[Trustbox] hydrate(${trigger}): window.Trustpilot not yet defined — script may still be loading`,
        );
        return;
      }
      if (typeof tp.loadFromElement !== "function") {
        console.error(
          `[Trustbox] hydrate(${trigger}): window.Trustpilot exists but loadFromElement is missing`,
          { trustpilotKeys: Object.keys(tp) },
        );
        return;
      }
      if (!ref.current) {
        console.warn(`[Trustbox] hydrate(${trigger}): container ref is null`);
        return;
      }
      try {
        tp.loadFromElement(ref.current, true);
        console.info(
          `[Trustbox] hydrate(${trigger}): loadFromElement called`,
          {
            templateId: tpl,
            businessUnitId: buid,
            container: ref.current.outerHTML.slice(0, 200),
          },
        );
      } catch (err) {
        console.error(
          `[Trustbox] hydrate(${trigger}): loadFromElement threw`,
          err,
        );
      }
    },
    [tpl, buid],
  );

  useEffect(() => {
    hydrate("useEffect");
    // After 4s, if the bootstrap still hasn't replaced the fallback <a>
    // with the rendered iframe, surface one console.error with enough state
    // to diagnose. Most common causes (in order):
    //   1. Unclaimed Trustpilot business profile — bootstrap silently no-ops
    //   2. CSP blocks the iframe injection (check Network/Console for refused frame-src)
    //   3. BUID typo — Trustpilot returns no widget data for unknown BUIDs
    //   4. Ad blocker stripped the bootstrap script
    const timer = window.setTimeout(() => {
      const node = ref.current;
      if (!node) {
        console.warn("[Trustbox] 4s probe: container ref is null");
        return;
      }
      const iframe = node.querySelector("iframe");
      if (iframe) {
        console.info("[Trustbox] 4s probe: widget hydrated successfully");
        return;
      }
      // Diagnostic dump — what ELSE is in the container? Did Trustpilot
      // inject anything at all?
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tp = (typeof window !== "undefined" ? (window as any).Trustpilot : null);
      const stillHasFallbackLink = !!node.querySelector('a[href*="trustpilot.com"]');
      console.error(
        "[Trustbox] 4s probe: widget did NOT hydrate — diagnostic dump below",
        {
          templateId: tpl,
          businessUnitId: buid,
          windowTrustpilotPresent: !!tp,
          loadFromElementPresent: !!(tp && typeof tp.loadFromElement === "function"),
          containerInnerHTML: node.innerHTML.slice(0, 500),
          containerChildCount: node.children.length,
          stillHasFallbackLink,
          containerDimensions: {
            offsetWidth: node.offsetWidth,
            offsetHeight: node.offsetHeight,
            clientWidth: node.clientWidth,
            clientHeight: node.clientHeight,
          },
          troubleshooting: [
            "1. Confirm profile is claimed at https://business.trustpilot.com",
            "2. Check Network tab for failed widget.trustpilot.com requests (CSP/adblocker)",
            `3. Verify BUID at https://au.trustpilot.com/review/askarthur.au matches '${buid}'`,
            "4. Check the Console for any 'Refused to frame' CSP errors",
          ],
        },
      );
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [hydrate, tpl, buid]);

  if (!tpl || !buid) return null;

  return (
    <>
      <Script
        src="//widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js"
        strategy="afterInteractive"
        onLoad={() => hydrate("onLoad")}
        onError={(err) => {
          console.error(
            "[Trustbox] bootstrap script failed to load — likely CSP block, ad-blocker, or network error",
            err,
          );
        }}
      />
      <div
        ref={ref}
        className="trustpilot-widget"
        data-locale="en-AU"
        data-template-id={tpl}
        data-businessunit-id={buid}
        data-style-height={height}
        data-style-width={width}
        data-theme={theme}
      >
        <a
          href="https://au.trustpilot.com/review/askarthur.au"
          target="_blank"
          rel="noopener noreferrer"
        >
          Trustpilot
        </a>
      </div>
    </>
  );
}
