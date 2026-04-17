"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "flexible" | "invisible";
        }
      ) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

function postToken(type: "token" | "error", token?: string, reason?: string) {
  if (typeof window === "undefined" || window === window.parent) return;
  window.parent.postMessage(
    {
      type: type === "token" ? "turnstile-token" : "turnstile-error",
      token,
      reason,
    },
    "*"
  );
}

export default function ExtensionTurnstilePage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderedRef = useRef(false);

  useEffect(() => {
    if (!SITE_KEY) {
      postToken("error", undefined, "missing-site-key");
    }
  }, []);

  const tryRender = () => {
    if (renderedRef.current) return;
    if (!window.turnstile || !containerRef.current || !SITE_KEY) return;
    renderedRef.current = true;
    window.turnstile.render(containerRef.current, {
      sitekey: SITE_KEY,
      theme: "light",
      callback: (token: string) => postToken("token", token),
      "error-callback": () => postToken("error", undefined, "widget-error"),
      "expired-callback": () => postToken("error", undefined, "expired"),
    });
  };

  return (
    <div
      style={{
        margin: 0,
        padding: 16,
        background: "transparent",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={tryRender}
        onLoad={tryRender}
      />
      <div ref={containerRef} id="turnstile-container" />
      {!SITE_KEY && (
        <p style={{ color: "#b00", fontSize: 14 }}>
          Turnstile is not configured.
        </p>
      )}
    </div>
  );
}
