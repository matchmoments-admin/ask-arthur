"use client";

import { useCallback, useEffect, useRef } from "react";
import Script from "next/script";

// Trustpilot's "Review Collector" template — the only widget the Free
// tier exposes. It renders as a CTA inviting visitors to leave a review
// (NOT a passive rating display). Verified 2026-05-10 after every other
// template ID returned `{"Error":["BusinessUnit does not have access to
// that trustbox"]}` from the trustbox-data endpoint — Trustpilot gates
// access per (BUID, template) pair via the dashboard's "Showcase →
// Website widgets" publish step.
//
// Review Collector requires `data-token` — a per-account anti-CSRF token
// generated when you publish the widget in the dashboard. Configure via
// NEXT_PUBLIC_TRUSTPILOT_DATA_TOKEN. Without the token, the widget will
// load but Trustpilot will refuse to record any reviews collected.
//
// To swap to a passive rating display (Mini, Micro Combo, Micro Star,
// etc.) you need a paid Trustpilot plan AND to publish that template in
// the dashboard, which gives you a different template ID + token to
// override these env vars with.
const DEFAULT_TEMPLATE_ID = "56278e9abfbbba0bdcd568bc";

interface TrustboxProps {
  /** Trustpilot template id. Defaults to "Review Collector" — the only
   *  widget the Free tier exposes. Override if you have a paid plan. */
  templateId?: string;
  /** Trustpilot business unit id. */
  businessUnitId?: string;
  /** Per-widget anti-CSRF token. Required for Review Collector; some
   *  paid templates also require it. Trustpilot generates this when
   *  you publish the widget in the dashboard. */
  dataToken?: string;
  /** Width — Trustpilot accepts pct or px. */
  width?: string;
  /** Height in px — must match the chosen template. Review Collector = 52px. */
  height?: string;
  /** Theme — light fits the footer, dark for contrast over hero. */
  theme?: "light" | "dark";
  /** BCP-47 locale. Trustpilot generates the embed code with the locale
   *  you picked when publishing the widget — match that here. */
  locale?: string;
}

/**
 * Trustpilot TrustBox widget. The Free tier only exposes "Review
 * Collector" — a CTA prompt that invites visitors to leave a review.
 *
 * Note: this is a behavioural shift from the original design intent
 * ("deliberately passive — we do NOT solicit reviews via in-app CTAs",
 * see /docs/plans/contact-feedback-and-onward-reporting.md §5). The
 * passive-display widgets we wanted (Mini, Micro Combo, etc.) require
 * a paid Trustpilot plan. If we re-evaluate that, this component can
 * be swapped to any other template by changing the env vars.
 *
 * No-ops if BUID + template are missing — local dev and unconfigured
 * previews render nothing instead of a broken placeholder.
 */
export default function Trustbox({
  templateId,
  businessUnitId,
  dataToken,
  width = "100%",
  height = "52px",
  theme = "light",
  locale,
}: TrustboxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const tpl =
    templateId ??
    process.env.NEXT_PUBLIC_TRUSTPILOT_TEMPLATE_ID ??
    DEFAULT_TEMPLATE_ID;
  const buid =
    businessUnitId ?? process.env.NEXT_PUBLIC_TRUSTPILOT_BUSINESS_UNIT_ID;
  const token = dataToken ?? process.env.NEXT_PUBLIC_TRUSTPILOT_DATA_TOKEN;
  const tpLocale = locale ?? process.env.NEXT_PUBLIC_TRUSTPILOT_LOCALE ?? "en-US";

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
        data-locale={tpLocale}
        data-template-id={tpl}
        data-businessunit-id={buid}
        data-style-height={height}
        data-style-width={width}
        data-theme={theme}
        {...(token ? { "data-token": token } : {})}
      >
        <a
          href="https://www.trustpilot.com/review/askarthur.au"
          target="_blank"
          rel="noopener noreferrer"
        >
          Trustpilot
        </a>
      </div>
    </>
  );
}
