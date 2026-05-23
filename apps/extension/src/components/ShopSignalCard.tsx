import type { AnalysisResult } from "@askarthur/types";
import { COMMERCE_FLAG_LABELS } from "@askarthur/types";
import { ShoppingBag, ExternalLink, Gauge } from "lucide-react";
import { VerdictHeader, VERDICT_CONFIG } from "./VerdictBadge";

interface ShopSignalCardProps {
  /** Analyze result for the active-tab commerce URL — must carry shopSignal. */
  result: AnalysisResult;
  /** The active-tab URL this card is reading. Used to build the deep-link. */
  url: string;
}

/**
 * Stage 2 PR 6 — extension popup's commerce-page verdict card.
 *
 * Rendered when the on-mount commerce-detector flagged the active tab AND
 * the backend returned a `shopSignal`. Mirrors the web app's ResultCard
 * shop-signal block (chips below the verdict) and offers a deep-link to
 * the Deep Shop Check tray on askarthur.au — the popup deliberately does
 * NOT embed the deep-check poll, see issue #323.
 */
export function ShopSignalCard({ result, url }: ShopSignalCardProps) {
  const config = VERDICT_CONFIG[result.verdict];
  const shopSignal = result.shopSignal;

  function openDeepCheck() {
    const target = `https://askarthur.au/?deepShopUrl=${encodeURIComponent(url)}`;
    chrome.tabs.create({ url: target }).catch(() => {
      // Best-effort — most popup-context errors here are dev-mode artefacts.
    });
  }

  return (
    <div role="alert" className="rounded-[10px] border border-border overflow-hidden">
      <VerdictHeader verdict={result.verdict} />

      <div className="bg-background px-4 py-4">
        {/* Active URL — small + truncated, so user knows what was checked. */}
        <p className="text-[11px] text-text-muted mb-2 truncate" title={url}>
          {url}
        </p>

        {/* Summary */}
        <p className="text-text-primary text-[13px] leading-relaxed mb-3">
          {result.summary}
        </p>

        {/* Confidence */}
        <div className={`flex items-center gap-2 mb-3 ${config.textColor}`}>
          <Gauge size={16} />
          <span className="text-[11px] font-semibold">
            {Math.round(result.confidence * 100)}% confidence
          </span>
        </div>

        {/* Commerce-flag chips — identical taxonomy to web ResultCard. */}
        {shopSignal && (
          <div className="mb-4">
            <div className="flex items-center gap-1.5 mb-2">
              <ShoppingBag size={14} className="text-text-secondary" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                Shop signals
              </span>
            </div>
            {shopSignal.commerceFlags.length === 0 ? (
              <span className="inline-block rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-text-secondary">
                Online shop detected
              </span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {shopSignal.commerceFlags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-block rounded-full border border-warn-border bg-warn-bg/40 px-2 py-0.5 text-[11px] text-warn-text"
                  >
                    {COMMERCE_FLAG_LABELS[tag] ?? tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Deep Shop Check deep-link — opens the full tray on askarthur.au. */}
        <button
          type="button"
          onClick={openDeepCheck}
          className="w-full flex items-center justify-center gap-1.5 h-10 px-4 bg-primary text-white font-semibold rounded-[8px] cta-glow hover:bg-primary-hover transition-colors duration-150 text-[13px]"
        >
          Run a deeper shop check
          <ExternalLink size={14} />
        </button>
        <p className="mt-1.5 text-[11px] text-text-muted text-center leading-relaxed">
          Opens askarthur.au — checks the ABN, domain age, and reputation.
        </p>
      </div>
    </div>
  );
}
