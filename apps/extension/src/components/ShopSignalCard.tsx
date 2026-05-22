import { useState, useEffect } from "react";
import type { AnalysisResult } from "@askarthur/types";
import { COMMERCE_FLAG_LABELS } from "@askarthur/types";
import { ShoppingBag, ExternalLink } from "lucide-react";
import type { MessageResponse } from "@/lib/types";
import {
  detectCommerceSignals,
  type CommerceDetectionResult,
} from "@/lib/commerce-detector";
import { VerdictHeader } from "./VerdictBadge";
import { LoadingSpinner } from "./LoadingSpinner";

type Phase =
  | "detecting" // injecting + running the commerce detector
  | "analyzing" // shop confirmed, waiting on the backend verdict
  | "result" // verdict in hand
  | "not-shop" // active tab is a normal page
  | "error" // backend verdict failed
  | "unsupported"; // chrome:// page, no active tab, injection blocked

/**
 * Shop Signal in the popup (#323). On open it reads the active tab,
 * one-shot injects the commerce detector via chrome.scripting (covered by
 * `activeTab` + `scripting` — no `<all_urls>`, no content script), and
 * surfaces the verdict for shop-shaped pages. Rendered only when the
 * extension was built with WXT_SHOP_GUARD=true.
 */
export function ShopSignalCard() {
  const [phase, setPhase] = useState<Phase>("detecting");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [shopUrl, setShopUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1. Resolve the active tab (URL is available under `activeTab`).
      let tab: chrome.tabs.Tab | undefined;
      try {
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        tab = tabs[0];
      } catch {
        if (!cancelled) setPhase("unsupported");
        return;
      }

      const url = tab?.url;
      const tabId = tab?.id;
      if (!url || typeof tabId !== "number" || !/^https?:\/\//i.test(url)) {
        if (!cancelled) setPhase("unsupported");
        return;
      }

      // 2. One-shot inject the commerce detector into the active tab.
      let detection: CommerceDetectionResult | undefined;
      try {
        const injected = await chrome.scripting.executeScript({
          target: { tabId },
          func: detectCommerceSignals,
        });
        detection = injected[0]?.result as CommerceDetectionResult | undefined;
      } catch {
        // chrome:// pages, the Web Store, the PDF viewer, etc. reject
        // injection — nothing to show.
        if (!cancelled) setPhase("unsupported");
        return;
      }
      if (cancelled) return;

      if (!detection || !detection.isShop) {
        setPhase("not-shop");
        return;
      }

      // 3. Shop-shaped — ask the backend for a Shop Signal verdict.
      setShopUrl(url);
      setPhase("analyzing");
      try {
        const response: MessageResponse = await chrome.runtime.sendMessage({
          type: "ANALYZE_SHOP",
          url,
        });
        if (cancelled) return;
        if (response.success && response.data) {
          setResult(response.data as AnalysisResult);
          setPhase("result");
        } else {
          setPhase("error");
        }
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Non-shop / unsupported pages stay out of the way entirely.
  if (phase === "unsupported") return null;

  if (phase === "detecting" || phase === "analyzing") {
    return (
      <div className="rounded-[10px] border border-border bg-surface p-3">
        <LoadingSpinner
          message={
            phase === "detecting"
              ? "Checking this page..."
              : "Analysing this shop..."
          }
        />
      </div>
    );
  }

  if (phase === "not-shop") {
    return (
      <div className="rounded-[10px] border border-border bg-surface px-3 py-2.5 flex items-center gap-2">
        <ShoppingBag size={14} className="text-text-muted shrink-0" />
        <p className="text-[11px] text-text-secondary">
          Not a shopping page — paste any URL below to check it.
        </p>
      </div>
    );
  }

  if (phase === "error" || !result) {
    return (
      <div className="rounded-[10px] border border-border bg-surface px-3 py-2.5 flex items-center gap-2">
        <ShoppingBag size={14} className="text-text-muted shrink-0" />
        <p className="text-[11px] text-text-secondary">
          Couldn&apos;t check this shop right now — try the URL check below.
        </p>
      </div>
    );
  }

  const flags = result.shopSignal?.commerceFlags ?? [];
  const deepCheckUrl = shopUrl
    ? `https://askarthur.au/?shared_text=${encodeURIComponent(shopUrl)}`
    : "https://askarthur.au/";

  return (
    <div
      role="alert"
      className="rounded-[10px] border border-border overflow-hidden"
    >
      <VerdictHeader verdict={result.verdict} />
      <div className="bg-background px-4 py-3 space-y-2.5">
        {/* Commerce-flag chips — shared labels with the web ResultCard. */}
        <div className="flex items-center gap-1.5">
          <ShoppingBag size={14} className="text-text-secondary shrink-0" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
            Shop signals
          </span>
        </div>
        {flags.length === 0 ? (
          <span className="inline-block rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-text-secondary">
            Online shop detected
          </span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {flags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-warn/30 bg-warn/10 px-2 py-0.5 text-[11px] text-warn"
              >
                {COMMERCE_FLAG_LABELS[tag] ?? tag}
              </span>
            ))}
          </div>
        )}

        <p className="text-[12px] text-text-secondary leading-relaxed">
          {result.summary}
        </p>

        {/* Deeper check is a deep-link to the web app — the extension never
            embeds the Deep Shop Check tray. */}
        <a
          href={deepCheckUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 w-full py-2 text-[11px] font-semibold text-primary border border-primary/30 rounded-[8px] hover:bg-primary-light transition-colors duration-150"
        >
          Run a deeper shop check
          <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}
