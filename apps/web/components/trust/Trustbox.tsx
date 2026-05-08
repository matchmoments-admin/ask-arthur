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
  const hydrate = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tp = (typeof window !== "undefined" ? (window as any).Trustpilot : null);
    if (!tp) {
      console.warn("[Trustbox] window.Trustpilot not yet defined on hydrate");
      return;
    }
    if (!ref.current) {
      console.warn("[Trustbox] container ref missing on hydrate");
      return;
    }
    tp.loadFromElement(ref.current, true);
  }, []);

  useEffect(() => {
    hydrate();
    // After 4s, if the bootstrap still hasn't replaced the fallback <a>
    // with the rendered iframe, surface one console.error. The most common
    // cause is an unclaimed Trustpilot business profile — the bootstrap
    // silently no-ops when the BUID points to an unverified profile.
    const timer = window.setTimeout(() => {
      const node = ref.current;
      if (!node) return;
      const hasIframe = node.querySelector("iframe");
      if (!hasIframe) {
        console.error(
          "[Trustbox] widget did not hydrate after 4s — verify the Trustpilot business profile for this BUID is claimed and public",
        );
      }
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [hydrate]);

  if (!tpl || !buid) return null;

  return (
    <>
      <Script
        src="//widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js"
        strategy="afterInteractive"
        onLoad={hydrate}
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
