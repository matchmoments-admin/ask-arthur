"use client";

import { useCallback, useEffect, useRef } from "react";
import Script from "next/script";

interface TrustboxProps {
  /** Trustpilot template id (provided by Trustpilot when claiming a profile).
   *  We use the "Micro Combo" template by default which is small + monochrome.
   *  Override per page if needed. */
  templateId?: string;
  /** Trustpilot business unit id. */
  businessUnitId?: string;
  /** Width — Trustpilot accepts pct or px. */
  width?: string;
  /** Height in px. */
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
  height = "52px",
  theme = "light",
}: TrustboxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const tpl = templateId ?? process.env.NEXT_PUBLIC_TRUSTPILOT_TEMPLATE_ID;
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
    if (tp && ref.current) {
      tp.loadFromElement(ref.current, true);
    }
  }, []);

  useEffect(() => {
    hydrate();
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
