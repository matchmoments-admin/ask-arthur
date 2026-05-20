"use client";

import { useId, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, ChevronDown, CircleX, Eye, HandCoins, ShoppingBag, TriangleAlert } from "lucide-react";
import ResultFeedback from "./result/ResultFeedback";
import ResultActionButtons from "./result/ResultActionButtons";
import OnwardReportPicker from "./result/OnwardReportPicker";
import type { EvidenceContext } from "@/lib/onward/destinations";
import type { ScammerContacts, ShopSignal } from "@askarthur/types";

// Shop Signal commerce-flag tags → user-facing label. Stage 0 ships a
// fixed mapping; if Stage 0.5 adds new tags, extend here. Unknown tags
// fall through to their raw kebab-case form rather than being dropped —
// surfacing the unknown is better than silently hiding it.
const SHOP_FLAG_LABEL: Record<string, string> = {
  "payid-scam": "PayID-shaped scam",
  "fake-payment-confirmation": "Fake payment confirmation",
  "overpayment-refund": "Overpayment refund scam",
  "off-platform-move": "Moves you off-platform",
  "relative-will-collect": "Buyer's relative collects",
  "implausible-discount": "Discount too good to be true",
  "domain-renewal-invoice": "Fake .com.au domain invoice",
  "stock-photo-product": "Stock-photo product listing",
  "fake-trust-badge": "Fake trust badge",
  "fake-australia-post": "Fake Australia Post notice",
  "urgent-purchase-pressure": "Urgent purchase pressure",
  "fake-reviews": "Suspicious reviews",
};

const PAID_PROVIDER_VERDICT_LABEL: Record<"safe" | "suspicious" | "risky", string> = {
  safe: "Low third-party risk",
  suspicious: "Third-party caution",
  risky: "Third-party high risk",
};

const PAID_PROVIDER_VERDICT_TONE: Record<"safe" | "suspicious" | "risky", string> = {
  safe: "border-emerald-200 bg-emerald-50 text-emerald-800",
  suspicious: "border-warn-border bg-warn-bg/40 text-warn-heading",
  risky: "border-danger-border bg-danger-bg text-danger-text",
};

type Verdict = "SAFE" | "SUSPICIOUS" | "HIGH_RISK";

interface ResultCardProps {
  verdict: Verdict;
  confidence: number;
  summary: string;
  redFlags: string[];
  nextSteps: string[];
  countryCode?: string | null;
  deepfakeScore?: number;
  deepfakeProvider?: string;
  phoneRiskFlags?: string[];
  isVoipCaller?: boolean;
  scamType?: string;
  impersonatedBrand?: string;
  scammerContacts?: ScammerContacts;
  scammerUrls?: Array<{ url: string; isMalicious: boolean; sources: string[] }>;
  channel?: string;
  inputMode?: string;
  onCheckAnother?: () => void;
  contentHash?: string;
  analysisId?: string;
  scamReportId?: number;
  /** v0.2e charity-intent CTA. When the analyze route detected
   *  charity-shaped input (keyword or 11-digit ABN), this object surfaces
   *  whatever was extractable so we can deep-link the user into the
   *  dedicated /charity-check page pre-filled. Renders as a banner
   *  ABOVE the verdict so users see the more-specific tool first. */
  charityIntent?: {
    detected: true;
    extractedAbn?: string;
    extractedName?: string;
  };
  /** Shop Guard Stage 0 — when the input looked commerce-shaped, surface
   *  the deduplicated commerce-flag chip row beneath the verdict. Plan:
   *  docs/plans/shop-guard-v2.md. */
  shopSignal?: ShopSignal;
}

interface VerdictStyle {
  baseTitle: string;
  icon: LucideIcon;
  chipBg: string;
  chipBorder: string;
  iconColor: string;
  flagBar: string;
}

// Token-driven verdict styling. Two amber levels (low-risk + suspicious) +
// red for high-risk. Never say "safe" — the lightest tier still nudges the
// user to verify. Tokens are defined in apps/web/app/globals.css:35–44.
const VERDICT_CONFIG: Record<Verdict, VerdictStyle> = {
  SAFE: {
    baseTitle: "No clear red flags — still proceed with caution",
    icon: Eye,
    chipBg: "bg-warn-bg/40",
    chipBorder: "border-warn-border/70",
    iconColor: "text-warn-text",
    flagBar: "bg-warn-text",
  },
  SUSPICIOUS: {
    baseTitle: "This looks suspicious",
    icon: TriangleAlert,
    chipBg: "bg-warn-bg",
    chipBorder: "border-warn-border",
    iconColor: "text-warn-heading",
    flagBar: "bg-warn-heading",
  },
  HIGH_RISK: {
    baseTitle: "This looks like a scam",
    icon: CircleX,
    chipBg: "bg-danger-bg",
    chipBorder: "border-danger-border",
    iconColor: "text-danger-text",
    flagBar: "bg-danger-text",
  },
};

function resolveTitle(verdict: Verdict, scamType: string | undefined): string {
  const base = VERDICT_CONFIG[verdict].baseTitle;
  if (verdict !== "HIGH_RISK") return base;
  const t = (scamType ?? "").trim().toLowerCase();
  if (!t || t === "none" || t === "unknown") return base;
  const withScam = /scam$/.test(t) ? t : `${t} scam`;
  return `This looks like a ${withScam}`;
}

// Claude currently returns redFlags as flat strings. Split on the first
// sentence boundary so we can render a bold heading + muted body like the
// competitor layout. Heuristic only — the upstream prompt can later return
// {heading, body} shapes and this helper retires.
function splitFlag(flag: string): { heading: string; body: string } {
  const trimmed = flag.trim();
  const match = trimmed.match(/^([^.:!?]+)[.:!?]\s+([\s\S]+)$/);
  if (match) {
    return { heading: match[1].trim(), body: match[2].trim() };
  }
  return { heading: trimmed, body: "" };
}

export default function ResultCard({
  verdict,
  redFlags,
  scamType,
  impersonatedBrand,
  scammerContacts,
  scammerUrls,
  channel,
  onCheckAnother,
  contentHash,
  analysisId,
  scamReportId,
  charityIntent,
  shopSignal,
}: ResultCardProps) {
  const config = VERDICT_CONFIG[verdict];
  const title = resolveTitle(verdict, scamType);
  const Icon = config.icon;
  const paidProviderVerdict = shopSignal?.paidProviderVerdict;
  const [shopSignalOpen, setShopSignalOpen] = useState(false);
  const shopSignalDetailId = useId();
  // Picker is only useful when we have a scam_reports row to attach the
  // onward log entries to; otherwise the picker has nothing to forward.
  const showReport = verdict !== "SAFE" && typeof scamReportId === "number";
  const [showPicker, setShowPicker] = useState(false);

  async function handleReport() {
    // Audit: write a 'user_reported' verdict_feedback row regardless of
    // which destinations the user later picks. This preserves the existing
    // analytics signal (how many users hit the report button).
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verdictGiven: verdict,
          userSays: "user_reported",
          analysisId,
          scamReportId,
          contentHash,
          locale:
            typeof navigator !== "undefined"
              ? navigator.language || "en-AU"
              : "en-AU",
        }),
      });
    } catch {
      // Best-effort — matches ResultFeedback's fire-and-forget pattern.
    }
    setShowPicker(true);
  }

  // Build the evidence context once and reuse for the picker + summary.
  const evidence: EvidenceContext = {
    reportRef: scamReportId
      ? `ASK-${String(scamReportId).padStart(6, "0")}`
      : "ASK-pending",
    scamType: scamType ?? null,
    impersonatedBrand: impersonatedBrand ?? null,
    channel: channel ?? null,
    scammerUrls: (scammerUrls ?? []).map((u) => u.url),
    scammerPhones:
      scammerContacts?.phoneNumbers.map((p) => p.value) ?? [],
    scammerEmails:
      scammerContacts?.emailAddresses.map((e) => e.value) ?? [],
    redFlags,
    receivedAt: new Date().toISOString(),
  };

  const flagItems =
    redFlags.length > 0
      ? redFlags.map((f) => splitFlag(f))
      : [
          {
            heading: "Nothing obvious flagged",
            body: "No tool catches everything — verify through official channels before you act.",
          },
        ];

  // Build a /charity-check?... URL pre-filled with whatever charity-intent
  // detection extracted. Both fields optional — the dedicated page handles
  // either, both, or neither.
  const charityCheckHref = charityIntent
    ? (() => {
        const params = new URLSearchParams();
        if (charityIntent.extractedAbn) params.set("abn", charityIntent.extractedAbn);
        if (charityIntent.extractedName) params.set("name", charityIntent.extractedName);
        const qs = params.toString();
        return qs ? `/charity-check?${qs}` : "/charity-check";
      })()
    : null;

  return (
    <div
      role="alert"
      className="mt-6 rounded-lg border border-slate-200 bg-white px-5 py-5 sm:px-6 sm:py-6"
    >
      {/* Charity-intent CTA — surfaced ABOVE the generic verdict because the
          dedicated /charity-check tool is more specific to what the user is
          asking about. Verdict still renders below as the safety net. */}
      {charityIntent && charityCheckHref && (
        <a
          href={charityCheckHref}
          className="mb-5 flex items-center justify-between gap-3 rounded-lg border-2 border-deep-navy bg-deep-navy/5 px-4 py-3 text-deep-navy hover:bg-deep-navy/10 transition"
        >
          <div className="flex items-center gap-3">
            <HandCoins size={24} className="shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold leading-tight">
                This looks like a charity request
              </p>
              <p className="text-xs text-gov-slate leading-snug mt-0.5">
                {charityIntent.extractedName
                  ? `Run a full check on "${charityIntent.extractedName}"`
                  : charityIntent.extractedAbn
                    ? `Run a full check on ABN ${charityIntent.extractedAbn}`
                    : "Run a full check against the ACNC, ABR, and donation-URL safety registers"}
              </p>
            </div>
          </div>
          <ArrowRight size={20} className="shrink-0" aria-hidden="true" />
        </a>
      )}

      {/* Verdict chip */}
      <div
        className={`flex items-center gap-3 rounded-lg border-2 px-4 py-3 ${config.chipBg} ${config.chipBorder}`}
      >
        <Icon className={`${config.iconColor} shrink-0`} size={28} aria-hidden="true" />
        <h2 className="text-lg font-bold text-deep-navy leading-tight">
          {title}
        </h2>
      </div>

      {/* Shop Guard Stage 0 — commerce-flag chips. Renders when shopSignal is
          present AND at least one tag was extracted. Empty-flag case (commerce
          detected but no specific tag) renders a single "Online shop detected"
          chip — surfacing the detection itself is part of the measurement
          goal in the 30-day Stage 0 window. */}
      {shopSignal && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ShoppingBag size={16} className="text-gov-slate shrink-0" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wide text-gov-slate">
            Shop signals
          </span>
          {shopSignal.commerceFlags.length === 0 ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-gov-slate">
              Online shop detected
            </span>
          ) : (
            shopSignal.commerceFlags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-warn-border bg-warn-bg/40 px-2 py-0.5 text-xs text-warn-text"
              >
                {SHOP_FLAG_LABEL[tag] ?? tag}
              </span>
            ))
          )}
        </div>
      )}

      {paidProviderVerdict && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50">
          <button
            type="button"
            aria-expanded={shopSignalOpen}
            aria-controls={shopSignalDetailId}
            onClick={() => setShopSignalOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <span>
              <span className="block text-xs font-semibold uppercase tracking-wide text-gov-slate">
                Shop trust check
              </span>
              <span className="mt-1 block text-sm font-bold text-deep-navy">
                {PAID_PROVIDER_VERDICT_LABEL[paidProviderVerdict.verdict]}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${PAID_PROVIDER_VERDICT_TONE[paidProviderVerdict.verdict]}`}
              >
                {paidProviderVerdict.trustScore}/100
              </span>
              <ChevronDown
                size={18}
                className={`text-gov-slate transition-transform ${shopSignalOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </span>
          </button>
          {shopSignalOpen && (
            <div
              id={shopSignalDetailId}
              className="border-t border-slate-200 px-4 pb-4 pt-3 text-sm text-gov-slate"
            >
              <p>
                APIVoid checked the shop host for trust and blacklist signals. This is a
                supporting signal only, not a site audit grade.
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Blacklists
                  </dt>
                  <dd className="font-bold text-deep-navy">
                    {paidProviderVerdict.blacklistDetections}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Provider
                  </dt>
                  <dd className="font-bold text-deep-navy">APIVoid</dd>
                </div>
              </dl>
              {paidProviderVerdict.flags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {paidProviderVerdict.flags.map((flag) => (
                    <span
                      key={flag}
                      className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs"
                    >
                      {flag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Red flag cards */}
      <ul className="mt-6 space-y-5">
        {flagItems.map((flag, i) => (
          <li key={i} className="flex gap-3">
            <span
              aria-hidden="true"
              className={`block w-1 rounded-full shrink-0 self-stretch ${config.flagBar}`}
            />
            <div>
              <p className="text-base font-bold text-deep-navy leading-snug mb-1">
                {flag.heading}
              </p>
              {flag.body && (
                <p className="text-base text-gov-slate leading-relaxed">
                  {flag.body}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Remember disclaimer */}
      <div className="mt-6 border-y border-slate-200 py-4">
        <p className="text-sm text-gov-slate leading-relaxed">
          <span className="font-bold text-deep-navy">Remember:</span>{" "}
          Arthur is a free resource to be used alongside your own research and
          best judgment. Always verify information through official channels
          and use caution when clicking links.
        </p>
      </div>

      {/* Thumbs feedback */}
      <ResultFeedback
        verdictGiven={verdict}
        analysisId={analysisId}
        scamReportId={scamReportId}
        contentHash={contentHash}
      />

      {/* Onward report picker — opens inline when user clicks "Report this scam".
          The picker swaps to OnwardReportSummary after the user submits. */}
      {showPicker && scamReportId && (
        <OnwardReportPicker
          scamReportId={scamReportId}
          analysisId={analysisId}
          scamType={scamType}
          impersonatedBrand={impersonatedBrand}
          channel={channel}
          evidence={evidence}
          onClose={() => setShowPicker(false)}
        />
      )}

      {/* Two-button footer */}
      {onCheckAnother && (
        <ResultActionButtons
          onCheckAnother={onCheckAnother}
          onReport={showReport ? handleReport : undefined}
          showReport={showReport}
        />
      )}
    </div>
  );
}
